import { it, expect } from 'vitest';
import { applyOutline } from '../src/domain/outline';
import { requestedChapters, readableLength } from '../src/domain/requirements';
import { splitArticle } from '../src/shared';
it.each([
  ['按三个主题章节整理', 3],
  ['分为5章', 5],
  ['整理成十个章节', 10],
  ['不限章节', undefined],
  ['分成20章', undefined],
])('extracts a bounded explicit chapter count from %s', (input, count) =>
  expect(requestedChapters(input)).toBe(count),
);
it('counts readable text without inflating numbers with source anchors', () =>
  expect(readableLength('# 标题\n\n中文 [原文](#source-c0001)')).toBe(4));
it('enforces headings without rewriting content or losing citations', () => {
  const input =
    '# Title\n\nIntro\n\n## First\n\nOriginal A. [原文](#source-c0001)\n\n## Second\n\nOriginal B. [原文](#source-c0002)';
  const result = applyOutline(input, '分为一章');
  expect(splitArticle(result)).toHaveLength(1);
  expect(result).toContain('Original A. [原文](#source-c0001)');
  expect(result).toContain('Original B. [原文](#source-c0002)');
});
it('preserves a structure that already matches', () => {
  const input = '# Title\n\n## One\n\nText';
  expect(applyOutline(input, '一章')).toBe(input);
});
it('wraps a one-topic short note into the requested single chapter', () => {
  const input = '# 相遇\n\n一句完整的原文复述。 [原文](#source-c0001)';
  const result = applyOutline(input, '按一个章节整理');
  expect(splitArticle(result)).toHaveLength(1);
  expect(result).toContain('一句完整的原文复述。 [原文](#source-c0001)');
});
it('splits only at paragraph boundaries when more chapters are requested', () => {
  const text = '# Title\n\n## Topic\n\nFirst paragraph.\n\nSecond paragraph.\n\nThird paragraph.';
  const result = applyOutline(text, '三个章节');
  expect(splitArticle(result)).toHaveLength(3);
  for (const paragraph of ['First paragraph.', 'Second paragraph.', 'Third paragraph.'])
    expect(result).toContain(paragraph);
});
