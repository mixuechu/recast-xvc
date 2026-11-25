import { expect, it } from 'vitest';
import { requestedLength, withinLength } from '../src/domain/length';
it.each([
  ['保留真实对话，分四章，约1500字', { min: 1350, max: 1650, target: 1500 }],
  ['不超过1500字', { min: 0, max: 1500, target: 1350 }],
  ['控制在1,500字以内', { min: 0, max: 1500, target: 1350 }],
  ['全文1000–1500字', { min: 1000, max: 1500, target: 1250 }],
  ['一千五百字左右', { min: 1350, max: 1650, target: 1500 }],
  ['约1.5千字', { min: 1350, max: 1650, target: 1500 }],
  ['至少1500字', { min: 1500, max: undefined, target: 1650 }],
  ['严格1500字', { min: 1500, max: 1500, target: 1500 }],
  ['标题20字以内，正文约1500字', { min: 1350, max: 1650, target: 1500 }],
  ['每章300字，全文1000至1500字', { min: 1000, max: 1500, target: 1250 }],
  ['不少于1000字，不超过1500字', { min: 1000, max: 1500, target: 1100 }],
  ['不超过1500字且不少于1000字', { min: 1000, max: 1500, target: 1350 }],
  ['少于1500字', { min: 0, max: 1499, target: 1349 }],
  ['1000字到1500字', { min: 1000, max: 1500, target: 1250 }],
  ['一千字至一千五百字', { min: 1000, max: 1500, target: 1250 }],
  ['不要超过1500字', { min: 0, max: 1500, target: 1350 }],
  ['不得超过1500字', { min: 0, max: 1500, target: 1350 }],
  ['不高于1500字', { min: 0, max: 1500, target: 1350 }],
  ['1500字 以内', { min: 0, max: 1500, target: 1350 }],
  ['控制在1500字左右', { min: 1350, max: 1650, target: 1500 }],
])('extracts an overall budget: %s', (input, budget) =>
  expect(requestedLength(input)).toEqual(budget),
);
it.each(['不限篇幅，保留1500美元的事实', '每章约300字', '标题20字以内', '保留原话'])(
  'does not confuse local or non-length requirements: %s',
  (input) => expect(requestedLength(input)).toBeUndefined(),
);
it.each(['2000至1000字', '至少1800字，不超过1500字', '10万字'])(
  'rejects conflicting or unsupported budgets: %s',
  (input) => expect(() => requestedLength(input)).toThrow(),
);
it('enforces the declared range including its boundaries', () => {
  const budget = requestedLength('约1500字')!;
  expect([1349, 1350, 1650, 1651].map((n) => withinLength(n, budget))).toEqual([
    false,
    true,
    true,
    false,
  ]);
});
it.each(['从3000字压缩到1500字', '将3000字的原稿压缩到1500字', '原文3000字，整理成约1500字'])(
  'distinguishes the source length from the requested output: %s',
  (input) => {
    expect(requestedLength(input)).toEqual({ min: 1350, max: 1650, target: 1500 });
  },
);
