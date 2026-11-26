import { expect, it } from 'vitest';
import { readGemini } from '../src/protocol/gemini';
const start = (index: number, type: string) => ({
  event_type: 'step.start',
  index,
  step: { type },
});
const delta = (index: number, type: string, text: string) => ({
  event_type: 'step.delta',
  index,
  delta: { type, text },
});
async function collect(events: unknown[], signal = new AbortController().signal) {
  const body = new Response(
    events.map((e) => `data: ${typeof e === 'string' ? e : JSON.stringify(e)}\n\n`).join(''),
  ).body!;
  let text = '';
  for await (const chunk of readGemini(body, signal)) text += chunk;
  return text;
}
it('emits only model output, skipping thought text, signatures and completed snapshots', async () => {
  expect(
    await collect([
      start(0, 'thought'),
      delta(0, 'text', 'private'),
      delta(0, 'thought_signature', 'signature'),
      start(1, 'model_output'),
      delta(1, 'text', '中文'),
      delta(1, 'text', '回答'),
      {
        event_type: 'interaction.completed',
        interaction: { status: 'completed', steps: [{ content: [{ text: '中文回答' }] }] },
      },
      '[DONE]',
    ]),
  ).toBe('中文回答');
});
it.each([
  ['disconnect', [start(0, 'model_output'), delta(0, 'text', 'partial')]],
  ['done without completion', ['[DONE]']],
  ['incomplete', [{ event_type: 'interaction.completed', interaction: { status: 'incomplete' } }]],
  ['provider error', [{ event_type: 'error', error: { code: 'service_unavailable' } }]],
  ['failed', [{ event_type: 'interaction.failed' }]],
  ['cancelled', [{ event_type: 'interaction.cancelled' }]],
])('rejects %s rather than reporting success', async (_reason, events) => {
  await expect(collect(events as unknown[])).rejects.toThrow();
});
it('honors cancellation', async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(collect([], controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
});
