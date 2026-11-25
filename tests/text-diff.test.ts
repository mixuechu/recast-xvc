import { it, expect } from 'vitest';
import { textDiff } from '../src/domain/text-diff';
it('highlights changed numbers while preserving the original text', () => {
  const result = textDiff('Revenue grew 15 percent.', 'Revenue grew 50 percent.');
  expect(
    result.original
      .filter((p) => p.changed)
      .map((p) => p.text)
      .join(''),
  ).toBe('15');
  expect(
    result.candidate
      .filter((p) => p.changed)
      .map((p) => p.text)
      .join(''),
  ).toBe('50');
  expect(result.original.map((p) => p.text).join('')).toBe('Revenue grew 15 percent.');
});
it('highlights Chinese character changes', () =>
  expect(textDiff('三个项目', '四个项目').candidate.filter((p) => p.changed)).toEqual([
    { text: '四', changed: true },
  ]));
it('bounds work on very large unmatched groups without dropping content', () => {
  const a = 'alpha '.repeat(1000),
    b = 'beta '.repeat(1000),
    result = textDiff(a, b);
  expect(result.original.map((p) => p.text).join('')).toBe(a);
  expect(result.candidate.map((p) => p.text).join('')).toBe(b);
});
