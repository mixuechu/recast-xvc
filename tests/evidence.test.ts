import { describe, it, expect } from 'vitest';
import { normalizeCaptions, parseCaptions, clock } from '../src/domain/captions';
import { citationIds, validCitations, validateCitedSummary } from '../src/domain/evidence';
import { compareCaptions, applyDecisions, reviewedCaptions } from '../src/domain/comparison';
import { publicAudioUrl } from '../src/server/recognition';
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
      normalizeCaptions([{ text: 'x'.repeat(100001), offset: 0, duration: 1 }]),
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
describe('human-reviewed alignment', () => {
  it('flags numbers and keeps unchanged captions confirmed', () => {
    const rows = compareCaptions(source, parseCaptions(srt));
    expect(rows[0]).toMatchObject({ changed: true, confirmed: false });
    expect(rows[0].reasons).toContain('数字有差异');
    expect(rows[1].confirmed).toBe(true);
  });
  it('requires confirmation before producing a revised source', () =>
    expect(() => reviewedCaptions(compareCaptions(source, parseCaptions(srt)))).toThrow('确认'));
  it('applies decisions without mutating the source or duplicating content', () => {
    const rows = compareCaptions(source, parseCaptions(srt));
    const resolved = applyDecisions(rows, [{ id: rows[0].id, decision: 'candidate' }]);
    expect(rows[0].confirmed).toBe(false);
    expect(reviewedCaptions(resolved)[0].text).toContain('50');
  });
  it('aligns one long ASR utterance to several subtitle cues exactly once', () => {
    const rows = compareCaptions(source, [
      { text: 'One longer sentence.', offset: 0, duration: 4 },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].original).toBe('Revenue is 15 percent. Do not ship it yet.');
    expect(rows[0].candidate).toBe('One longer sentence.');
  });
  it('preserves unmatched candidate segments for explicit review', () => {
    const rows = compareCaptions(source, [...source, { text: 'Extra.', offset: 8, duration: 2 }]);
    expect(rows.at(-1)).toMatchObject({ original: '', candidate: 'Extra.', confirmed: false });
  });
  it('rejects untimed candidates and duplicate decisions', () => {
    expect(() => compareCaptions(source, [{ text: 'text', offset: 0, duration: 0 }])).toThrow(
      '时间轴',
    );
    const rows = compareCaptions(source, parseCaptions(srt));
    expect(() =>
      applyDecisions(rows, [
        { id: rows[0].id, decision: 'original' },
        { id: rows[0].id, decision: 'candidate' },
      ]),
    ).toThrow();
  });
  it('requires nonempty edits', () =>
    expect(() =>
      applyDecisions(compareCaptions(source, parseCaptions(srt)), [
        { id: 'row-1', decision: 'edited', text: '' },
      ]),
    ).toThrow());
});
describe('recognition URL validation', () => {
  it.each([
    'http://example.com/audio.mp3',
    'https://127.0.0.1/a.wav',
    'https://localhost/a.wav',
    'https://internal.local/a.wav',
    'https://name:password@example.com/a.wav',
    'https://example.com/page',
  ])('rejects %s', (url) => expect(() => publicAudioUrl(url)).toThrow());
  it('accepts a public HTTPS file with a signed query', () =>
    expect(publicAudioUrl('https://media.example.com/audio.mp3?token=short-lived')).toBe(
      'https://media.example.com/audio.mp3?token=short-lived',
    ));
});
