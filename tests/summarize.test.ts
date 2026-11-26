import { afterEach, expect, it, vi } from 'vitest';
import { summarize } from '../src/server/session/summarize';
import { generate } from '../src/server/ai';
import { dimensions } from '../src/shared';
import type { StoredArticle } from '../src/server/session/types';
vi.mock('../src/server/ai', () => ({ generate: vi.fn(), summarySystem: 'summary' }));
afterEach(() => vi.clearAllMocks());
const source = {
  kind: 'manual' as const,
  title: '原稿',
  captions: [{ id: 'c0001', text: '先明确任务边界，再选择工具。', offset: 0, duration: 2 }],
};
const chapter = { id: 'chapter-1', title: '边界', markdown: '先明确边界。 [原文](#source-c0001)' };
const stored = { source, markdown: '# 标题\n\n## 边界\n\n' + chapter.markdown } as StoredArticle;
const env = { AI_PROVIDER: 'deepseek', AI_MODEL: 'test' };
const valid = Object.fromEntries(
  dimensions.map((k) => [
    k,
    k === 'What'
      ? { text: '先明确任务边界。', status: 'supported', citationIds: ['c0001'] }
      : { text: '未明确提及', status: 'not-mentioned', citationIds: [] },
  ]),
);
it('retries an invalid structured summary once with the same source context and timeout', async () => {
  let count = 0;
  vi.mocked(generate).mockImplementation(async function* () {
    yield JSON.stringify(
      count++
        ? valid
        : { ...valid, What: { text: '越界', status: 'supported', citationIds: ['c9999'] } },
    );
  });
  expect(await summarize(env, stored, chapter)).toEqual(valid);
  const calls = vi.mocked(generate).mock.calls;
  expect(calls).toHaveLength(2);
  expect(calls[0][3]).toBe(calls[1][3]);
  expect(JSON.parse(calls[1][2]).transcript).toBe(JSON.parse(calls[0][2]).transcript);
  expect(JSON.parse(calls[1][2]).validationFeedback).toBeTruthy();
});
it('does not loop or accept an invalid summary after the second attempt', async () => {
  vi.mocked(generate).mockImplementation(async function* () {
    yield '{}';
  });
  await expect(summarize(env, stored, chapter)).rejects.toThrow('总结格式');
  expect(generate).toHaveBeenCalledTimes(2);
});
it('does not retry upstream failures as format errors', async () => {
  vi.mocked(generate).mockImplementation(async function* () {
    throw new Error('Upstream quota');
  });
  await expect(summarize(env, stored, chapter)).rejects.toThrow('Upstream quota');
  expect(generate).toHaveBeenCalledTimes(1);
});
