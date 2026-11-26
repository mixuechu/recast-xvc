import { readSSE } from './sse';

export async function* readChatCompletions(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
): AsyncGenerator<string> {
  let completed = false;
  for await (const data of readSSE(body, signal)) {
    if (data === '[DONE]') {
      completed = true;
      break;
    }
    const chunk = JSON.parse(data);
    if (chunk.error) throw new Error('模型生成中断，请重试。');
    const reason = chunk.choices?.[0]?.finish_reason;
    if (reason && !['STOP', 'stop'].includes(reason))
      throw new Error('生成未完整结束，请缩短字幕或要求后重试。');
    if (reason === 'STOP' || reason === 'stop') completed = true;
    const text = chunk.choices?.[0]?.delta?.content;
    if (text) yield text;
  }
  signal.throwIfAborted();
  if (!completed) throw new Error('模型连接提前断开，请重新生成。');
}
