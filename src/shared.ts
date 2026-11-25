export type Caption = { text: string; offset: number; duration: number };
export type Source = {
  title: string;
  videoId?: string;
  kind: 'youtube' | 'sample' | 'manual';
  captions: Caption[];
};
export type Chapter = { id: string; title: string; markdown: string };
export const dimensions = ['Who', 'What', 'When', 'Where', 'Why', 'How'] as const;
export type Summary = Record<(typeof dimensions)[number], string>;
export type Article = {
  id: string;
  source: Omit<Source, 'captions'>;
  requirements: string;
  markdown: string;
  chapters: Chapter[];
  createdAt: number;
  status: 'generating' | 'complete' | 'interrupted';
  expiresAt: number;
};
export function videoId(input: string): string {
  let u: URL;
  try {
    u = new URL(input);
  } catch {
    throw new Error('请输入完整的 YouTube 视频链接。');
  }
  if (!['https:', 'http:'].includes(u.protocol) || u.username || u.password || u.port)
    throw new Error('视频链接格式不正确。');
  const host = u.hostname.toLowerCase();
  let id: string | null = null;
  if (host === 'youtu.be') id = u.pathname.slice(1).split('/')[0];
  else if (
    ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com'].includes(host)
  ) {
    id =
      u.pathname === '/watch'
        ? u.searchParams.get('v')
        : (/^\/(shorts|embed|live)\/([^/]+)/.exec(u.pathname)?.[2] ?? null);
  }
  if (!id || !/^[\w-]{11}$/.test(id))
    throw new Error('请使用有效的 YouTube 视频链接，支持 watch、短链接和 Shorts。');
  return id;
}
export function splitArticle(markdown: string): Chapter[] {
  const parts = markdown.split(/^##\s+(.+)\r?$/m);
  const chapters: Chapter[] = [];
  for (let i = 1; i < parts.length; i += 2)
    chapters.push({
      id: `chapter-${chapters.length + 1}`,
      title: parts[i].trim(),
      markdown: parts[i + 1]?.trim() ?? '',
    });
  return chapters;
}
export function validateSummary(data: unknown): Summary {
  if (!data || typeof data !== 'object') throw new Error('总结格式不正确，请重试。');
  const record = data as Record<string, unknown>;
  for (const key of dimensions)
    if (
      typeof record[key] !== 'string' ||
      !record[key].trim() ||
      (record[key] as string).length > 1600
    )
      throw new Error('总结字段不完整，请重试。');
  return Object.fromEntries(dimensions.map((key) => [key, record[key]])) as Summary;
}
