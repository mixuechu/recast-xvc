import { splitArticle } from '../shared';
import { requestedChapters } from './requirements';
// Enforce an explicit chapter count by regrouping existing paragraphs, never inventing content.
export function applyOutline(markdown: string, requirements: string): string {
  const count = requestedChapters(requirements),
    chapters = splitArticle(markdown);
  if (!count || count === chapters.length) return markdown;
  if (count === 1 && !chapters.length) {
    const heading = markdown.match(/^#\s+.+$/m)?.[0] ?? '# 内容整理',
      content = markdown.replace(/^#\s+.+\r?\n?/m, '').trim();
    if (!content) throw new Error('原文内容为空。');
    return `${heading}\n\n## 原文内容\n\n${content}`;
  }
  const intro = markdown.split(/^##\s+/m)[0].trim();
  const units =
    chapters.length >= count
      ? chapters.map((c) => ({ title: c.title, text: c.markdown }))
      : chapters.flatMap((c) =>
          c.markdown
            .split(/\n\s*\n/)
            .filter(Boolean)
            .map((text) => ({ title: c.title, text })),
        );
  if (units.length < count)
    throw new Error(`原文内容不足以整理为 ${count} 个有依据的章节，请减少章节数量。`);
  const groups = Array.from({ length: count }, (_, i) =>
    units.slice(
      Math.floor((i * units.length) / count),
      Math.floor(((i + 1) * units.length) / count),
    ),
  );
  const seen = new Map<string, number>();
  return (
    intro +
    '\n\n' +
    groups
      .map((group) => {
        const title = [...new Set(group.map((unit) => unit.title))].join(' · ');
        const occurrence = (seen.get(title) ?? 0) + 1;
        seen.set(title, occurrence);
        const heading =
          title + (occurrence > 1 ? `（续${occurrence === 2 ? '' : occurrence - 1}）` : '');
        const content = group
          .map(
            (unit, i) =>
              `${i === 0 || group[i - 1].title !== unit.title ? `### ${unit.title}\n\n` : ''}${unit.text}`,
          )
          .join('\n\n');
        return `## ${heading}\n\n${content}`;
      })
      .join('\n\n')
  );
}
