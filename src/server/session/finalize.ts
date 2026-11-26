import { splitArticle, type GenerationStage, type ProcessingStage } from '../../shared';
import { citationIds, validCitations, normalizeCitationLinks } from '../../domain/evidence';
import { requestedLength, withinLength, lengthDescription } from '../../domain/length';
import { readableLength } from '../../domain/requirements';
import type { AIEnv } from '../ai';
import type { StoredArticle } from './types';
import { ensureEvidence } from './ensure-evidence';
import { fitLength } from './fit-length';
import { ProcessingError } from './processing-error';

type Checkpoint = (stage: ProcessingStage, markdown: string) => Promise<void>;
export async function finalizeDraft(
  env: AIEnv,
  record: StoredArticle,
  signal: AbortSignal,
  checkpoint: Checkpoint,
  status: (message: string, stage: GenerationStage) => void,
): Promise<string> {
  let markdown: string;
  try {
    markdown = normalizeCitationLinks(
      record.markdown,
      new Set(record.source.captions.flatMap((c) => (c.id ? [c.id] : []))),
    );
  } catch {
    throw new ProcessingError('初稿含无效的原文编号或引用格式，请重新生成。', false);
  }
  if (markdown !== record.markdown) await checkpoint(record.processingStage!, markdown);
  // 先调整篇幅，避免为随后会被省略的段落补引用；旧检查点也须重新验收字数。
  const budget = requestedLength(record.requirements);
  if (
    record.processingStage === 'length' ||
    (budget && !withinLength(readableLength(markdown), budget))
  ) {
    if (record.processingStage !== 'length') await checkpoint('length', markdown);
    if (budget && !withinLength(readableLength(markdown), budget)) {
      status(`正在调整篇幅（目标${lengthDescription(budget)}）`, 'length');
      markdown = await fitLength(env, markdown, record.requirements, budget, signal);
      signal.throwIfAborted();
    }
    await checkpoint('evidence', markdown);
  }
  status('正在核对原文引用', 'evidence');
  markdown = await ensureEvidence(
    env,
    record.source,
    markdown,
    signal,
    async (partial, checked, total) => {
      await checkpoint('evidence', partial);
      status(`正在补全原文引用（${checked}/${total}段）`, 'evidence');
    },
  );
  signal.throwIfAborted();
  const chapters = splitArticle(markdown);
  if (!chapters.length) throw new Error('模型未生成章节结构，请重新生成。');
  if (chapters.some((c) => !validCitations(c.markdown, record.source.captions).length))
    throw new Error('部分章节缺少有效原文依据，初稿已保留。');
  if (citationIds(markdown).length !== validCitations(markdown, record.source.captions).length)
    throw new Error('文章含无效的原文编号，初稿已保留。');
  if (budget && !withinLength(readableLength(markdown), budget))
    throw new Error('最终字数尚未达标，初稿已保留。');
  return markdown;
}
