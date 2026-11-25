export function requestedChapters(requirements: string): number | undefined {
  const match = requirements.match(
    /(?:分为|分成|按|共|整理成|整理为)?\s*([一二三四五六七八九十\d]+)\s*(?:个)?\s*(?:主题)?\s*章(?:节)?/,
  );
  if (!match) return;
  const numbers: Record<string, number> = {
    一: 1,
    二: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
    十: 10,
  };
  const value = numbers[match[1]] ?? Number(match[1]);
  return Number.isInteger(value) && value >= 1 && value <= 10 ? value : undefined;
}
export function readableLength(markdown: string) {
  return markdown
    .replace(/\[原文[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[\s#*_`>|-]/g, '').length;
}
