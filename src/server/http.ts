export const json = (data: unknown, status = 200) =>
  Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
export async function body(request: Request): Promise<Record<string, unknown>> {
  if (!request.body) throw new Error('请求内容为空。');
  const reader = request.body.getReader();
  let bytes = 0;
  const parts: Uint8Array[] = [];
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    bytes += value.length;
    if (bytes > 450_000) {
      await reader.cancel();
      throw new Error('请求过大，请缩短字幕。');
    }
    parts.push(value);
  }
  const buffer = new Uint8Array(bytes);
  let offset = 0;
  for (const part of parts) {
    buffer.set(part, offset);
    offset += part.length;
  }
  const result = JSON.parse(new TextDecoder().decode(buffer));
  if (!result || typeof result !== 'object' || Array.isArray(result))
    throw new Error('请求格式不正确。');
  return result;
}
export const message = (e: unknown) => (e instanceof Error ? e.message : '操作失败，请稍后重试。');
