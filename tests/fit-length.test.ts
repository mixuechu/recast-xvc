import { afterEach, expect, it, vi } from 'vitest';
import { fitLength } from '../src/server/session/fit-length';
import { generate } from '../src/server/ai';
import { articleBlocks, applyBlockEdits, renderBlocks } from '../src/domain/article-edits';
import { readableLength } from '../src/domain/requirements';
vi.mock('../src/server/ai', () => ({ generate: vi.fn() }));
afterEach(() => vi.clearAllMocks());
const env = { AI_PROVIDER: 'deepseek', AI_MODEL: 'test' },
  signal = () => new AbortController().signal;
const before =
  '# 访谈\n\n## 主题\n\n**主持人：** ' +
  '真实问题。'.repeat(40) +
  ' [原文](#source-c0001)\n\n**Marc：** ' +
  '真实回答。'.repeat(40) +
  ' [原文](#source-c0002)';
const after =
  '# 访谈\n\n## 主题\n\n**主持人：** 真实问题。 [原文](#source-c0001)\n\n**Marc：** 真实回答。 [原文](#source-c0002)';
const budget = { min: 0, max: 100, target: 90 };
const edits = {
  edits: [
    { id: 'p2', text: '真实问题。' },
    { id: 'p3', text: '真实回答。' },
  ],
};
function answer(data: unknown) {
  vi.mocked(generate).mockImplementation(async function* () {
    yield JSON.stringify(data);
  });
}
it('does not spend an editing request for text already in range', async () => {
  expect(await fitLength(env, after, '100字以内', budget, signal())).toBe(after);
  expect(generate).not.toHaveBeenCalled();
});
it('edits only text while program code owns titles, roles and references', async () => {
  answer(edits);
  expect(await fitLength(env, before, '100字以内', budget, signal())).toBe(after);
  expect(generate).toHaveBeenCalledTimes(1);
  const prompt = vi.mocked(generate).mock.calls[0][2];
  expect(prompt).not.toContain('source-c0001');
  expect(prompt).not.toContain('source-c0002');
  expect(JSON.parse(prompt).blocks.every((b: { hasEvidence: boolean }) => b.hasEvidence)).toBe(
    true,
  );
  expect(vi.mocked(generate).mock.calls[0][4]).toBe(true);
  expect(vi.mocked(generate).mock.calls[0][5]).toBe(10000);
});
it.each([
  [
    'unknown paragraph',
    {
      edits: [
        { id: 'p99', text: '内容' },
        { id: 'p3', text: '回答' },
      ],
    },
  ],
  [
    'duplicate paragraph',
    {
      edits: [
        { id: 'p2', text: '内容' },
        { id: 'p2', text: '回答' },
      ],
    },
  ],
  ['missing paragraph', { edits: [{ id: 'p2', text: '内容' }] }],
  [
    'invented source',
    {
      edits: [
        { id: 'p2', text: '问题 [原文](#source-c9999)' },
        { id: 'p3', text: '回答' },
      ],
    },
  ],
  [
    'invented speaker',
    {
      edits: [
        { id: 'p2', text: '**陌生人：** 内容' },
        { id: 'p3', text: '回答' },
      ],
    },
  ],
  [
    'inserted heading',
    {
      edits: [
        { id: 'p2', text: '## 新主题' },
        { id: 'p3', text: '回答' },
      ],
    },
  ],
  [
    'empty chapter',
    {
      edits: [
        { id: 'p2', text: '' },
        { id: 'p3', text: '' },
      ],
    },
  ],
  [
    'lost dialogue',
    {
      edits: [
        { id: 'p2', text: '' },
        { id: 'p3', text: '回答' },
      ],
    },
  ],
  [
    'new paragraph',
    {
      edits: [
        { id: 'p2', text: '问题\n\n新的断言' },
        { id: 'p3', text: '回答' },
      ],
    },
  ],
])('refuses an invalid edit: %s', async (_reason, data) => {
  answer(data);
  await expect(fitLength(env, before, '100字以内', budget, signal())).rejects.toThrow();
  expect(generate).toHaveBeenCalledTimes(1);
});
it('honors cancellation before accepting an edit', async () => {
  const controller = new AbortController();
  vi.mocked(generate).mockImplementation(async function* () {
    controller.abort();
    yield JSON.stringify(edits);
  });
  await expect(
    fitLength(env, before, '100字以内', budget, controller.signal),
  ).rejects.toMatchObject({ name: 'AbortError' });
});
it('bounds corrections and returns measured failure instead of cropping text', async () => {
  answer({
    edits: articleBlocks(before, false)
      .filter((b) => b.editable)
      .map((b) => ({ id: b.id, text: b.text })),
  });
  await expect(fitLength(env, before, '100字以内', budget, signal())).rejects.toThrow('实际');
  expect(generate).toHaveBeenCalledTimes(3);
});
it('feeds the measured count and last accepted text back to the editor', async () => {
  let calls = 0;
  vi.mocked(generate).mockImplementation(async function* () {
    yield JSON.stringify(
      calls++ === 0
        ? {
            edits: articleBlocks(before, false)
              .filter((b) => b.editable)
              .map((b) => ({ id: b.id, text: b.text })),
          }
        : edits,
    );
  });
  expect(await fitLength(env, before, '100字以内', budget, signal())).toBe(after);
  expect(vi.mocked(generate).mock.calls[1][2]).toContain('上一轮全篇实测');
  const prompts = vi.mocked(generate).mock.calls.map((call) => JSON.parse(call[2]));
  expect(prompts[1].bodyWritingBudget).toBeLessThan(prompts[0].bodyWritingBudget);
});
it('retains evidence even when original anchors use a supported alias', async () => {
  answer(edits);
  expect(
    await fitLength(env, before.replace(/#source-/g, '#source_'), '100字以内', budget, signal()),
  ).toBe(after);
});
it('keeps immutable metadata even if response ordering changes', () => {
  const blocks = articleBlocks(before, false);
  expect(applyBlockEdits(blocks, { edits: [...edits.edits].reverse() })).toBe(after);
});
it('leaves uncited short metadata unchanged and protects a requested lead', () => {
  const withLead =
    '# 访谈\n\n短导语。 [原文](#source-c0001)\n\n## 主题\n\n**Marc：** 回答。 [原文](#source-c0002)';
  const blocks = articleBlocks(withLead, true);
  expect(() =>
    applyBlockEdits(blocks, {
      edits: blocks
        .filter((b) => b.editable)
        .map((b) => ({ id: b.id, text: b.chapter === 0 ? '' : b.text })),
    }),
  ).toThrow();
  expect(
    renderBlocks(articleBlocks('# 访谈\n\n短说明。\n\n## 主题\n\n正文。', false), new Map()),
  ).toContain('短说明。');
});
it('measures the final rendered article including immutable metadata', async () => {
  answer(edits);
  const result = await fitLength(env, before, '100字以内', budget, signal());
  expect(readableLength(result)).toBeLessThanOrEqual(100);
});

it('can shorten a draft with not-yet-verified references before the separate evidence stage', () => {
  const uncited = before.replace(/ \[原文\]\([^)]*\)/g, '');
  const result = applyBlockEdits(articleBlocks(uncited, false), edits);
  expect(result).toBe(after.replace(/ \[原文\]\([^)]*\)/g, ''));
  expect(result).not.toContain('#source-');
});

it('edits chapters separately and rejects responses that target another chapter', async () => {
  const original =
    before +
    '\n\n## 下一主题\n\n**主持人：** ' +
    '第二个问题。'.repeat(30) +
    ' [原文](#source-c0001)\n\n**Marc：** ' +
    '第二个回答。'.repeat(30) +
    ' [原文](#source-c0002)';
  let calls = 0;
  vi.mocked(generate).mockImplementation(async function* (_env, _system, prompt) {
    const request = JSON.parse(prompt);
    expect(request.blocks).toHaveLength(2);
    yield JSON.stringify({
      edits: request.blocks.map((b: { id: string }) => ({
        id: b.id,
        text: calls === 0 ? '真实问题。' : '真实回答。',
      })),
    });
    calls++;
  });
  const result = await fitLength(env, original, '100字以内', budget, signal());
  expect(calls).toBe(2);
  expect(result).toContain('## 下一主题');
  expect(result.match(/source-c0001/g)).toHaveLength(2);
  vi.mocked(generate).mockImplementation(async function* () {
    yield JSON.stringify(edits);
  });
  await expect(fitLength(env, original, '100字以内', budget, signal())).rejects.toThrow(
    '段落不完整',
  );
});
