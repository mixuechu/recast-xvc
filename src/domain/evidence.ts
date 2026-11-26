import { dimensions, type Caption, type CitedSummary } from '../shared';
export function normalizeCitationLinks(markdown: string, known: ReadonlySet<string>): string {
  const link = (label: string, id: string) => {
    if (!known.has(id)) throw new Error('文章引用了不存在的原文片段，已保留正文，请重新生成。');
    return `[${label}](#source-${id})`;
  };
  return markdown
    .replace(/\[([^\]]*)\]\(#source[-_=:]([^)]+)\)/gi, (_match, label: string, token: string) => {
      const cue = /^c{0,2}(\d{4,})$/i.exec(token);
      if (!cue) throw new Error('原文引用格式无效，已保留正文，请重新生成。');
      return link(label, `c${cue[1]}`);
    })
    .replace(/\[([^\]]*)\]\(#c(\d{4,})\)/gi, (_match, label: string, digits: string) =>
      link(label, `c${digits}`),
    );
}

export function citationIds(markdown: string): string[] {
  return [...new Set([...markdown.matchAll(/\]\(#(?:source[-_=:])?(c\d+)\)/g)].map((m) => m[1]))];
}
export function validCitations(markdown: string, captions: Caption[]): string[] {
  const known = new Set(captions.map((c) => c.id));
  return citationIds(markdown).filter((id) => known.has(id));
}
export function validateCitedSummary(data: unknown, captions: Caption[]): CitedSummary {
  if (!data || typeof data !== 'object') throw new Error('总结格式不正确，请重试。');
  const result = {} as CitedSummary;
  const known = new Set(captions.map((c) => c.id));
  for (const key of dimensions) {
    const item = (data as Record<string, unknown>)[key] as {
      text?: unknown;
      citationIds?: unknown;
      status?: unknown;
    };
    if (
      !item ||
      typeof item.text !== 'string' ||
      !item.text.trim() ||
      item.text.length > 1600 ||
      !Array.isArray(item.citationIds) ||
      item.citationIds.length > 6 ||
      !['supported', 'not-mentioned'].includes(String(item.status))
    )
      throw new Error('总结格式或原文依据不完整，请重试。');
    if (item.citationIds.some((id) => typeof id !== 'string' || !known.has(id)))
      throw new Error('总结引用了不存在的原文，已拒绝展示，请重试。');
    if (item.status === 'supported' && !item.citationIds.length)
      throw new Error('总结缺少原文依据，请重试。');
    if (item.status === 'not-mentioned' && (item.citationIds.length || item.text !== '未明确提及'))
      throw new Error('未提及的字段不得附带推测或引用。');
    result[key] = {
      text: item.text,
      citationIds: [...new Set(item.citationIds)] as string[],
      status: item.status as 'supported' | 'not-mentioned',
    };
  }
  return result;
}
