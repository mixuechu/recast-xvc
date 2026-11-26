import type { Chapter, CitedSummary } from '../../shared';
import { validCitations, validateCitedSummary } from '../../domain/evidence';
import { generate, summarySystem, type AIEnv } from '../ai';
import { sourceText } from '../transcript';
import type { StoredArticle } from './types';
export async function summarize(
  env: AIEnv,
  stored: StoredArticle,
  chapter: Chapter,
): Promise<CitedSummary> {
  const signal = AbortSignal.timeout(60000);
  const context = {
    transcript: sourceText(stored.source),
    article: stored.markdown,
    currentChapter: chapter,
    chapterEvidence: validCitations(chapter.markdown, stored.source.captions),
  };
  for (let attempt = 0; attempt < 2; attempt++) {
    let text = '';
    for await (const delta of generate(
      env,
      summarySystem,
      JSON.stringify({
        ...context,
        validationFeedback: attempt
          ? '上一轮输出未通过结构或引用校验，请重新核对六个字段和引用。'
          : undefined,
        finalReminder:
          '只输出Who、What、When、Where、Why、How六个对象。每项仅一至两句，text、status、citationIds缺一不可。supported项只选1至3个最直接支持结论的真实字幕编号；未提到的信息必须为text="未明确提及"、status="not-mentioned"、citationIds=[]。不要为覆盖更多细节而堆砌引用。',
      }),
      signal,
      true,
    ))
      text += delta;
    signal.throwIfAborted();
    // 只补试结果校验失败；上游请求错误在此前退出，两次尝试共用总超时。
    try {
      return validateCitedSummary(
        JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, '')),
        stored.source.captions,
      );
    } catch (error) {
      if (attempt === 1) throw error;
    }
  }
  throw new Error('总结未通过校验，请重试。');
}
