import { youtubeSource } from './youtube';
import { videoId, type Source } from '../shared';
import { normalizeCaptions, parseCaptions, clock } from '../domain/captions';
import { sample } from './sample';
import { publisherSource } from './catalog';
export type SourceInput = { mode?: string; url?: string; transcript?: string };
export async function getSource(input: SourceInput, signal: AbortSignal): Promise<Source> {
  if (input.mode === 'sample')
    return {
      ...structuredClone(sample),
      provider: 'sample',
      captions: normalizeCaptions(sample.captions),
    };
  if (input.mode === 'manual') {
    const text = input.transcript?.trim() ?? '';
    if (text.length < 80) throw new Error('请粘贴至少 80 字的字幕内容。');
    if (text.length > 100_000) throw new Error('字幕最多支持 100,000 字，请分段整理。');
    return {
      kind: 'manual',
      title: '导入的字幕',
      provider: 'manual',
      captions: parseCaptions(text),
    };
  }
  const id = videoId(input.url ?? '');
  try {
    return await youtubeSource(id, signal);
  } catch (e) {
    if (signal.aborted) throw e;
    const publisher = await publisherSource(id, signal);
    if (publisher) return publisher;
    if (e instanceof Error && e.message.includes('100,000')) throw e;
    throw new Error(
      '无法获取 YouTube 字幕，可能未开启字幕或受到访问限制。请从视频的“显示转录稿”复制内容，或导入 SRT / VTT。',
    );
  }
}
export function sourceText(source: Source) {
  return source.captions
    .map(
      (c, i) =>
        `[${c.id ?? `c${String(i + 1).padStart(4, '0')}`}] ${c.duration > 0 ? `[${clock(c.offset)}] ` : ''}${c.speaker ? `${c.speaker}: ` : ''}${c.text}`,
    )
    .join('\n');
}
