import { describe, it, expect } from 'vitest';
import { normalizeCaptions, parseCaptions, clock, captionText } from '../src/domain/captions';
import { citationIds, validCitations, validateCitedSummary } from '../src/domain/evidence';
import { dimensions } from '../src/shared';
const source = normalizeCaptions([
  { text: 'Revenue is 15 percent.', offset: 0, duration: 2 },
  { text: 'Do not ship it yet.', offset: 2, duration: 2 },
]);
const srt =
  '1\n00:00:00,000 --> 00:00:02,000\nRevenue is 50 percent.\n\n2\n00:00:02,000 --> 00:00:04,000\nDo not ship it yet.\n';
describe('timestamped sources', () => {
  it('parses SRT with preserved times and stable IDs', () =>
    expect(parseCaptions(srt)).toEqual([
      { id: 'c0001', text: 'Revenue is 50 percent.', offset: 0, duration: 2 },
      { id: 'c0002', text: 'Do not ship it yet.', offset: 2, duration: 2 },
    ]));
  it('parses VTT settings and multiline cues', () =>
    expect(
      parseCaptions('WEBVTT\n\n00:02.500 --> 00:04.000 align:start\nHello\nworld\n')[0],
    ).toMatchObject({ offset: 2.5, duration: 1.5, text: 'Hello world' }));
  it('rejects a partially corrupted time file rather than silently dropping cues', () =>
    expect(() => parseCaptions(srt + '\n3\ninvalid --> invalid\nmissing')).toThrow());
  it('rejects a negative interval', () =>
    expect(() => parseCaptions('00:04.000 --> 00:02.000\nInvalid')).toThrow());
  it('rejects empty and oversized sources', () => {
    expect(() => normalizeCaptions([])).toThrow();
    expect(() =>
      normalizeCaptions([{ text: 'x'.repeat(150001), offset: 0, duration: 1 }]),
    ).toThrow();
  });
  it('preserves plain text without invented timestamps', () =>
    expect(parseCaptions('One paragraph.\n\nAnother paragraph.').map((c) => c.duration)).toEqual([
      0, 0,
    ]));
  it('formats hour-long videos correctly', () => expect(clock(3670.5)).toBe('1:01:10'));
});
describe('evidence contracts', () => {
  it('only resolves existing source IDs', () => {
    const md = 'Text [原文](#source-c0001) [bad](#source-c9999) [原文](#source-c0001)';
    expect(citationIds(md)).toEqual(['c0001', 'c9999']);
    expect(validCitations(md, source)).toEqual(['c0001']);
  });
  const summary = () =>
    Object.fromEntries(
      dimensions.map((key) => [
        key,
        { text: 'Supported claim', status: 'supported', citationIds: ['c0001'] },
      ]),
    ) as Record<string, unknown>;
  it('accepts cited fields and explicitly absent fields', () => {
    const data = summary();
    data.When = { text: '未明确提及', status: 'not-mentioned', citationIds: [] };
    expect(validateCitedSummary(data, source).When.status).toBe('not-mentioned');
  });
  it('rejects fabricated IDs', () => {
    const data = summary();
    data.Who = { text: 'A', status: 'supported', citationIds: ['c9999'] };
    expect(() => validateCitedSummary(data, source)).toThrow('不存在');
  });
  it('rejects claims without evidence', () => {
    const data = summary();
    data.Who = { text: 'A', status: 'supported', citationIds: [] };
    expect(() => validateCitedSummary(data, source)).toThrow();
  });
  it('rejects guessing hidden behind not-mentioned', () => {
    const data = summary();
    data.Where = { text: 'Probably Boston', status: 'not-mentioned', citationIds: [] };
    expect(() => validateCitedSummary(data, source)).toThrow();
  });
});
it('restores imported subtitle timing and plain text for another generation', () => {
  const cues = [
    { text: 'First.', offset: 0.125, duration: 2.375 },
    { text: 'Next.', offset: 4.5, duration: 1.5 },
  ];
  expect(
    parseCaptions(captionText(cues)).map(({ text, offset, duration }) => ({
      text,
      offset,
      duration,
    })),
  ).toEqual(cues);
  expect(captionText([{ text: 'Untimed source.', offset: 0, duration: 0 }])).toBe(
    'Untimed source.',
  );
});

it('accepts a long English interview without dropping transcript text', () => {
  const text = 'English interview. '.repeat(5500);
  expect(normalizeCaptions([{ text, offset: 0, duration: 7200 }])[0].text).toBe(text.trim());
});
