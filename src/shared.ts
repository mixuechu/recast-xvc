export type Caption = {
  id?: string;
  text: string;
  offset: number;
  duration: number;
  speaker?: string;
};
export type Source = {
  title: string;
  videoId?: string;
  kind: 'youtube' | 'sample' | 'manual';
  captions: Caption[];
  provider?: 'youtube' | 'publisher' | 'manual' | 'sample' | 'reviewed';
  sourceUrl?: string;
  notice?: string;
  trackType?: 'manual' | 'automatic' | 'unknown';
  language?: string;
  license?: string;
  retrieval?: 'live' | 'snapshot';
};
export type Chapter = { id: string; title: string; markdown: string };
export const dimensions = ['Who', 'What', 'When', 'Where', 'Why', 'How'] as const;
export type Article = {
  id: string;
  source: Omit<Source, 'captions'>;
  requirements: string;
  markdown: string;
  chapters: Chapter[];
  createdAt: number;
  status: 'generating' | 'complete' | 'interrupted';
  expiresAt: number;
  sourceRevision?: number;
  parentId?: string;
  citationCount?: number;
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
export type CitedField = {
  text: string;
  citationIds: string[];
  status: 'supported' | 'not-mentioned';
};
export type CitedSummary = Record<(typeof dimensions)[number], CitedField>;
export type ReviewDecision = 'original' | 'candidate' | 'edited';
export type ComparisonRow = {
  id: string;
  captionId: string;
  offset: number;
  duration: number;
  original: string;
  candidate: string;
  changed: boolean;
  reasons: string[];
  decision: ReviewDecision;
  confirmed: boolean;
  edited?: string;
};
export type Review = {
  version: number;
  provider: 'import' | 'volcengine';
  createdAt: number;
  rows: ComparisonRow[];
};
export type Recognition = {
  taskId: string;
  status: 'queued' | 'running' | 'complete' | 'failed' | 'cancelled';
  createdAt: number;
  error?: string;
  nextPollAt: number;
  attempts: number;
};
export type SourceMeta = Omit<Source, 'captions'>;
export type GenerationEvent =
  | { type: 'session'; id: string }
  | { type: 'status'; message: string }
  | ({ type: 'source' } & SourceMeta)
  | { type: 'delta'; text: string }
  | {
      type: 'done';
      chapters: Chapter[];
      expiresAt: number;
      citationCount: number;
      markdown: string;
    }
  | { type: 'error'; message: string }
  | { type: 'heartbeat' };

export type AudioUpload = {
  url: string;
  filename: string;
  format: string;
  size: number;
  expiresAt: number;
};
