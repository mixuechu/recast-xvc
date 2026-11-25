import type { Caption } from '../shared';
const maxText = 150_000;
export class CaptionLimitError extends Error {
  constructor() {
    super('视频字幕最多支持 150,000 字符和 6,000 个片段，请分段整理。');
    this.name = 'CaptionLimitError';
  }
}
export function captionId(index: number) {
  return `c${String(index + 1).padStart(4, '0')}`;
}
export function normalizeCaptions(input: Caption[]): Caption[] {
  const result = input
    .filter((c) => c.text.trim())
    .map((c, i) => ({
      ...c,
      id: captionId(i),
      text: c.text
        .replace(
          /<\/?(?:c(?:\.[\w-]+)*|v(?:\s+[^>]+)?|b|i|u|ruby|rt|lang(?:\s+[^>]+)?)>|<\d{2}:\d{2}(?::\d{2})?\.\d{3}>/g,
          '',
        )
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .trim(),
    }));
  if (!result.length) throw new Error('字幕为空，请重新导入。');
  if (result.length > 6000 || result.reduce((sum, c) => sum + c.text.length, 0) > maxText)
    throw new CaptionLimitError();
  if (
    result.some(
      (c) =>
        !Number.isFinite(c.offset) ||
        !Number.isFinite(c.duration) ||
        c.offset < 0 ||
        c.duration < 0,
    )
  )
    throw new Error('字幕时间轴无效。');
  return result.sort((a, b) => a.offset - b.offset).map((c, i) => ({ ...c, id: captionId(i) }));
}
export function parseCaptions(text: string): Caption[] {
  if (text.length > 300_000) throw new Error('字幕文件过大。');
  const time = (value: string) => {
    const parts = value.replace(',', '.').split(':').map(Number);
    return parts.reduce((sum, n) => sum * 60 + n, 0);
  };
  const pattern =
    /(?:(\d{1,2}):)?(\d{2}:\d{2}[.,]\d{3})\s*-->\s*(?:(\d{1,2}):)?(\d{2}:\d{2}[.,]\d{3})[^\n]*\n([\s\S]*?)(?=\n\s*\n|$)/g;
  const timed = [...text.replace(/\r\n/g, '\n').matchAll(pattern)].map((m) => {
    const start = time((m[1] ? m[1] + ':' : '') + m[2]);
    const end = time((m[3] ? m[3] + ':' : '') + m[4]);
    if (end < start) throw new Error('字幕结束时间早于开始时间。');
    return { text: m[5].replace(/\n/g, ' ').trim(), offset: start, duration: end - start };
  });
  if (text.includes('-->') && timed.length !== (text.match(/-->/g)?.length ?? 0))
    throw new Error('无法解析时间轴，请使用标准 SRT 或 VTT 格式。');
  return normalizeCaptions(
    timed.length
      ? timed
      : text.split(/\n\s*\n/).map((t) => ({ text: t.trim(), offset: 0, duration: 0 })),
  );
}
export function clock(seconds: number) {
  const n = Math.floor(seconds);
  const h = Math.floor(n / 3600);
  return `${h ? `${h}:` : ''}${String(Math.floor(n / 60) % 60).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
}

// Reconstruct an editable transcript when reopening a saved manual source.
export function captionText(captions: Caption[]): string {
  if (!captions.some((c) => c.duration > 0)) return captions.map((c) => c.text).join('\n\n');
  const timestamp = (seconds: number) => {
    const ms = Math.round(seconds * 1000);
    return `${String(Math.floor(ms / 3600000)).padStart(2, '0')}:${String(Math.floor(ms / 60000) % 60).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`;
  };
  return captions
    .map(
      (c, i) =>
        `${i + 1}\n${timestamp(c.offset)} --> ${timestamp(c.offset + c.duration)}\n${c.speaker ? c.speaker + ': ' : ''}${c.text}`,
    )
    .join('\n\n');
}
