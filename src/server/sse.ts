// Handles UTF-8 boundaries, CRLF, multiline SSE data and a final event without a blank line.
export async function* readSSE(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const parse = (event: string) =>
    event
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).replace(/^ /, ''))
      .join('\n');
  const abort = () => {
    void reader.cancel().catch(() => {});
  };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    while (true) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      buffer = buffer.replace(/\r\n/g, '\n');
      let end: number;
      while ((end = buffer.indexOf('\n\n')) >= 0) {
        const data = parse(buffer.slice(0, end));
        buffer = buffer.slice(end + 2);
        if (data) yield data;
      }
      if (done) {
        if (buffer.trim()) {
          const data = parse(buffer);
          if (data) yield data;
        }
        break;
      }
      if (buffer.length > 2_000_000) throw new Error('流式响应过大。');
    }
  } finally {
    signal?.removeEventListener('abort', abort);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
