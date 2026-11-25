import { dimensions, type Caption, type CitedSummary } from '../shared';
export function normalizeCitationLinks(markdown: string, known: ReadonlySet<string>): string {
  return markdown.replace(
    /\[([^\]]*)\]\(#(?:source[-_=:])?(c\d{4,})\)/g,
    (_link, label: string, id: string) => {
      if (!known.has(id)) throw new Error('文章引用了不存在的原文片段，已保留正文，请重新生成。');
      return `[${label}](#source-${id})`;
    },
  );
}
export function citationIds(markdown: string): string[] {
  return [...new Set([...markdown.matchAll(/\]\(#source-(c\d+)\)/g)].map((m) => m[1]))];
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
