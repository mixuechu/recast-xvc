import { afterEach, expect, it, vi } from 'vitest';
import { fitLength } from '../src/server/session/fit-length';
import { generate } from '../src/server/ai';
import { readableLength } from '../src/domain/requirements';
vi.mock('../src/server/ai', () => ({ generate: vi.fn() }));
afterEach(() => vi.clearAllMocks());
const env = { AI_PROVIDER: 'zhipu', AI_MODEL: 'test' };
const signal = () => new AbortController().signal;
const before =
  '# 访谈\n\n## 主题\n\n**主持人：** ' +
  '真实问题。'.repeat(40) +
  ' [原文](#source-c0001)\n\n**Marc：** ' +
  '真实回答。'.repeat(40) +
  ' [原文](#source-c0002)';
const after =
  '# 访谈\n\n## 主题\n\n**主持人：** 真实问题。 [原文](#source-c0001)\n\n**Marc：** 真实回答。 [原文](#source-c0002)';
const budget = { min: 0, max: 100, target: 90 };
function answer(text: string) {
  vi.mocked(generate).mockImplementation(async function* () {
    yield text;
  });
}
it('does not spend an editing request for text already in range', async () => {
  expect(await fitLength(env, after, '100字以内', budget, signal())).toBe(after);
  expect(generate).not.toHaveBeenCalled();
});
it('uses one bounded editing request and preserves headings, speakers and references', async () => {
  answer(after);
  const result = await fitLength(env, before, '100字以内', budget, signal());
  expect(result).toBe(after);
  expect(readableLength(result)).toBeLessThanOrEqual(100);
  expect(generate).toHaveBeenCalledTimes(1);
});
it.each([
  ['still too long', before],
  ['missing chapter', after.replace('## 主题', '### 主题')],
  ['renamed chapter', after.replace('## 主题', '## 新主题')],
  ['invented speaker', after.replace('**Marc：**', '**陌生人：**')],
  ['lost dialogue', after.replace('**主持人：**', '').replace('**Marc：**', '')],
  ['invented citation', after.replace('c0002', 'c9999')],
  ['lost references', after.replace(/\[原文\]\([^)]*\)/g, '')],
])('refuses an invalid edit: %s', async (_reason, text) => {
  answer(text);
  await expect(fitLength(env, before, '100字以内', budget, signal())).rejects.toThrow();
  expect(generate).toHaveBeenCalledTimes(_reason === 'still too long' ? 2 : 1);
});
it('honors cancellation before accepting an edited result', async () => {
  const controller = new AbortController();
  vi.mocked(generate).mockImplementation(async function* () {
    controller.abort();
    yield after;
  });
  await expect(
    fitLength(env, before, '100字以内', budget, controller.signal),
  ).rejects.toMatchObject({ name: 'AbortError' });
});

it('feeds the measured overrun back into one final correction', async () => {
  let calls = 0;
  vi.mocked(generate).mockImplementation(async function* () {
    yield calls++ === 0 ? before : after;
  });
  expect(await fitLength(env, before, '100字以内', budget, signal())).toBe(after);
  expect(generate).toHaveBeenCalledTimes(2);
  expect(JSON.parse(vi.mocked(generate).mock.calls[1][2]).validationFeedback).toContain(
    '上一轮实际',
  );
});
it('can omit an optional lead without trimming a question, answer or sentence', async () => {
  const lead = after.replace('## 主题', '导语概述。'.repeat(30) + '\n\n## 主题');
  const tight = {
    min: readableLength(after),
    max: readableLength(after) + 5,
    target: readableLength(after),
  };
  expect(await fitLength(env, lead, '精简文章', tight, signal())).toBe(after);
  expect(generate).not.toHaveBeenCalled();
});
it('does not remove a lead explicitly required by the user', async () => {
  const lead = after.replace('## 主题', '导语概述。'.repeat(30) + '\n\n## 主题');
  answer(lead);
  await expect(fitLength(env, lead, '保留导语，100字以内', budget, signal())).rejects.toThrow();
});
it('does not treat an opening speaker turn as a disposable lead', async () => {
  const opening =
    '# 访谈\n\n**主持人：** ' +
    '真实问题。'.repeat(30) +
    ' [原文](#source-c0001)\n\n## 主题\n\n**Marc：** 真实回答。 [原文](#source-c0002)';
  answer(after);
  expect(await fitLength(env, opening, '100字以内', budget, signal())).toBe(after);
  expect(generate).toHaveBeenCalledTimes(1);
});
