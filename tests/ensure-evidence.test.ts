import { it, expect, vi, afterEach } from 'vitest';
import { ensureEvidence } from '../src/server/session/ensure-evidence';
import { generate } from '../src/server/ai';
import type { Source } from '../src/shared';
vi.mock('../src/server/ai', () => ({ generate: vi.fn() }));
afterEach(() => vi.clearAllMocks());
const source: Source = {
  kind: 'manual',
  title: 'Source',
  captions: [{ id: 'c0001', text: 'This explains the factual claim.', offset: 0, duration: 2 }],
};
const env = { AI_PROVIDER: 'zhipu', AI_MODEL: 'test' };
it('does not spend another request when references already exist', async () => {
  const text = '# T\n\nA sufficiently long supported paragraph. [原文](#source-c0001)';
  expect(await ensureEvidence(env, source, text, new AbortController().signal)).toBe(text);
  expect(generate).not.toHaveBeenCalled();
});
it('adds a bounded structured reference without rewriting the paragraph', async () => {
  vi.mocked(generate).mockImplementation(async function* () {
    yield JSON.stringify({ paragraphs: [{ id: 'p1', citationIds: ['c0001'] }] });
  });
  const original = '# Title\n\nA sufficiently long supported paragraph.';
  expect(await ensureEvidence(env, source, original, new AbortController().signal)).toBe(
    original + ' [原文](#source-c0001)',
  );
});
it('refuses fabricated and unsupported repair references', async () => {
  vi.mocked(generate).mockImplementation(async function* () {
    yield JSON.stringify({ paragraphs: [{ id: 'p1', citationIds: ['c9999'] }] });
  });
  await expect(
    ensureEvidence(
      env,
      source,
      '# Title\n\nA sufficiently long unsupported paragraph.',
      new AbortController().signal,
    ),
  ).rejects.toThrow('有效原文');
});

it('normalizes model cue anchors without another AI request and rejects invented aliases', async () => {
  const original = '# T\n\nA sufficiently long supported paragraph. [原文](#c0001)';
  expect(await ensureEvidence(env, source, original, new AbortController().signal)).toContain(
    '[原文](#source-c0001)',
  );
  expect(generate).not.toHaveBeenCalled();
  await expect(
    ensureEvidence(env, source, original.replace('c0001', 'c9999'), new AbortController().signal),
  ).rejects.toThrow('不存在');
});

it('repairs multiple dialogue turns in one request without changing the wording', async () => {
  vi.mocked(generate).mockImplementation(async function* () {
    yield JSON.stringify({
      paragraphs: [
        { id: 'p1', citationIds: ['c0001'] },
        { id: 'p2', citationIds: ['c0001'] },
      ],
    });
  });
  const first = '**提问者：** A sufficiently long real question.';
  const second = '**受访者：** A sufficiently long real answer.';
  expect(
    await ensureEvidence(
      env,
      source,
      '# T\n\n' + first + '\n\n' + second,
      new AbortController().signal,
    ),
  ).toBe('# T\n\n' + first + ' [原文](#source-c0001)\n\n' + second + ' [原文](#source-c0001)');
  expect(generate).toHaveBeenCalledTimes(1);
});
it.each(
  [
    [
      { id: 'p1', citationIds: ['c0001'] },
      { id: 'p1', citationIds: ['c0001'] },
    ],
    [{ id: 'p1', citationIds: ['c0001'] }],
    [
      { id: 'p1', citationIds: ['c0001'] },
      { id: 'p2', citationIds: [] },
    ],
  ].map((paragraphs) => [paragraphs]),
)('rejects duplicate, missing or unsupported paragraph repairs: %j', async (paragraphs) => {
  vi.mocked(generate).mockImplementation(async function* () {
    yield JSON.stringify({ paragraphs });
  });
  await expect(
    ensureEvidence(
      env,
      source,
      '# T\n\nA sufficiently long real question.\n\nA sufficiently long real answer.',
      new AbortController().signal,
    ),
  ).rejects.toThrow();
});

it('checks short dialogue questions, joins standalone speaker labels and drops empty labels', async () => {
  vi.mocked(generate).mockImplementation(async function* () {
    yield JSON.stringify({ paragraphs: [{ id: 'p1', citationIds: ['c0001'] }] });
  });
  const original = '# T\n\n**一位没有发言的受访者：**\n\n**提问者：**\n\n为什么？';
  expect(await ensureEvidence(env, source, original, new AbortController().signal)).toBe(
    '# T\n\n**提问者：** 为什么？ [原文](#source-c0001)',
  );
});

it('checkpoints successful batches and retries only the still-missing paragraphs', async () => {
  const original =
    '# T\n\n' +
    Array.from({ length: 13 }, (_, i) => `**提问者：** 第${i}个有待核对的真实问题。`).join('\n\n');
  let calls = 0;
  vi.mocked(generate).mockImplementation(async function* (_env, _system, prompt) {
    const data = JSON.parse(prompt);
    calls++;
    if (calls === 2) throw new Error('Transient failure');
    yield JSON.stringify({
      paragraphs: data.targetParagraphs.map((p: { id: string }) => ({
        id: p.id,
        citationIds: ['c0001'],
      })),
    });
  });
  let checkpoint = original;
  await expect(
    ensureEvidence(env, source, original, new AbortController().signal, async (partial) => {
      checkpoint = partial;
    }),
  ).rejects.toThrow('Transient');
  expect(checkpoint.match(/source-c0001/g) || []).toHaveLength(12);
  const result = await ensureEvidence(env, source, checkpoint, new AbortController().signal);
  expect(result.match(/source-c0001/g) || []).toHaveLength(13);
  expect(JSON.parse(vi.mocked(generate).mock.calls[2][2]).targetParagraphs).toHaveLength(1);
});
