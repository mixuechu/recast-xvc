import { fetchTranscript } from 'youtube-transcript-plus';
import { videoId, type Source } from '../shared';
import { sample } from './sample';
export async function getSource(
  input: { mode?: string; url?: string; transcript?: string },
  signal: AbortSignal,
): Promise<Source> {
  if (input.mode === 'sample') return structuredClone(sample);
  if (input.mode === 'manual') {
    const text = input.transcript?.trim() ?? '';
    if (text.length < 80) throw new Error('请粘贴至少 80 字的字幕内容。');
    if (text.length > 100_000) throw new Error('字幕最多支持 100,000 字，请分段整理。');
    return {
      kind: 'manual',
      title: '手动导入的字幕',
      captions: [{ text, offset: 0, duration: 0 }],
    };
  }
  const id = videoId(input.url ?? '');
  try {
    const captions = await fetchTranscript(id, { signal });
    if (!captions.length) throw new Error('empty');
    const source: Source = {
      kind: 'youtube',
      videoId: id,
      title: `YouTube · ${id}`,
      captions: captions.map((c) => ({
        text: decode(c.text),
        offset: c.offset,
        duration: c.duration,
      })),
    };
    if (source.captions.reduce((n, c) => n + c.text.length, 0) > 100_000)
      throw new Error('too-long');
    // Metadata is optional. A failed title lookup must not discard a usable transcript.
    try {
      const meta = await fetch(
        `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${id}&format=json`,
        { signal },
      );
      if (meta.ok) {
        const data = (await meta.json()) as { title?: string };
        if (data.title) source.title = data.title;
      }
    } catch {
      /* Keep the canonical video ID as the title. */
    }
    return source;
  } catch (e) {
    if (signal.aborted) throw e;
    if (e instanceof Error && e.message === 'too-long')
      throw new Error('字幕超过 100,000 字，请改用粘贴字幕分段整理。');
    throw new Error(
      '暂时无法获取这个视频的字幕，可能未开启字幕或受到 YouTube 访问限制。请粘贴字幕，或试试内置示例。',
    );
  }
}
function decode(text: string) {
  return text
    .replace(/&#(\d+);/g, (_, n) => {
      const code = Number(n);
      return code <= 0x10ffff ? String.fromCodePoint(code) : '';
    })
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}
export function sourceText(source: Source) {
  return source.captions
    .map(
      (c) =>
        `${
          source.kind === 'youtube'
            ? `[${Math.floor(c.offset / 60)
                .toString()
                .padStart(2, '0')}:${Math.floor(c.offset % 60)
                .toString()
                .padStart(2, '0')}] `
            : ''
        }${c.text}`,
    )
    .join('\n');
}
