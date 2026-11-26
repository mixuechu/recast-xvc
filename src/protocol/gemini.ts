import { readSSE } from './sse';

// Only model_output steps may contribute visible text; thoughts and signatures stay private.
export async function* readGemini(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
): AsyncGenerator<string> {
  const outputSteps = new Set<number>();
  let completed = false;
  for await (const data of readSSE(body, signal)) {
    if (data === '[DONE]') break;
    const event = JSON.parse(data);
    if (
      event.error ||
      ['error', 'interaction.failed', 'interaction.cancelled'].includes(event.event_type)
    )
      throw new Error('模型生成中断，请重试。');
    if (event.event_type === 'step.start') {
      if (event.step?.type === 'model_output') outputSteps.add(event.index);
      else outputSteps.delete(event.index);
    }
    if (
      event.event_type === 'step.delta' &&
      outputSteps.has(event.index) &&
      event.delta?.type === 'text'
    )
      yield event.delta.text ?? '';
    if (event.event_type === 'interaction.completed') {
      if (event.interaction?.status !== 'completed')
        throw new Error('生成未完整结束，请缩短字幕或要求后重试。');
      completed = true;
    }
  }
  signal.throwIfAborted();
  if (!completed) throw new Error('模型连接提前断开，请重新生成。');
}
