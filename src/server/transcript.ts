import { youtubeSource } from './youtube';
import { videoId, type Source } from '../shared';
import { normalizeCaptions, parseCaptions, clock } from '../domain/captions';
import { sample } from './sample';
import type { Env } from './env';
export type SourceInput = { mode?: string; url?: string; transcript?: string };
export async function getSource(
  input: SourceInput,
  signal: AbortSignal,
  env?: Pick<Env, 'TRANSCRIPTS' | 'SUPADATA_API_KEY'>,
): Promise<Source> {
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
  if (env?.TRANSCRIPTS) {
    const provider = env.SUPADATA_API_KEY ? 'supadata:en' : 'direct';
    const response = await env.TRANSCRIPTS.get(
      env.TRANSCRIPTS.idFromName(`v2:${provider}:${id}`),
    ).fetch(new Request(`https://internal/transcript?id=${id}`, { signal }));
    signal.throwIfAborted();
    const data = (await response.json()) as Source & { error?: string };
    if (!response.ok) throw new Error(data.error ?? '字幕读取失败，请稍后重试。');
    return data;
  }
  return youtubeSource(id, signal);
}
export function sourceText(source: Source) {
  return source.captions
    .map(
      (c, i) =>
        `[${c.id ?? `c${String(i + 1).padStart(4, '0')}`}] ${c.duration > 0 ? `[${clock(c.offset)}] ` : ''}${c.speaker ? `${c.speaker}: ` : ''}${c.text}`,
    )
    .join('\n');
}
