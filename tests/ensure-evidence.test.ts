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
    yield JSON.stringify({ citationIds: ['c0001'] });
  });
  const original = '# Title\n\nA sufficiently long supported paragraph.';
  expect(await ensureEvidence(env, source, original, new AbortController().signal)).toBe(
    original + ' [原文](#source-c0001)',
  );
});
it('refuses fabricated and unsupported repair references', async () => {
  vi.mocked(generate).mockImplementation(async function* () {
    yield JSON.stringify({ citationIds: ['c9999'] });
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
