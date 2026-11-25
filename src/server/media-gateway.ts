export type MediaGatewayEnv = { MEDIA_GATEWAY_URL?: string; MEDIA_GATEWAY_SECRET?: string };
export function mediaGateway(env: MediaGatewayEnv) {
  if (!env.MEDIA_GATEWAY_URL && !env.MEDIA_GATEWAY_SECRET) return null;
  if (!env.MEDIA_GATEWAY_URL || !env.MEDIA_GATEWAY_SECRET || env.MEDIA_GATEWAY_SECRET.length < 32)
    throw new Error('音频存储配置不完整，请检查服务端配置。');
  const origin = new URL(env.MEDIA_GATEWAY_URL);
  if (
    origin.protocol !== 'https:' ||
    origin.username ||
    origin.password ||
    origin.port ||
    origin.pathname !== '/' ||
    origin.search ||
    origin.hash
  )
    throw new Error('音频存储地址必须是 HTTPS 域名。');
  const request = async (
    object: string,
    method: 'PUT' | 'DELETE',
    bytes?: Uint8Array<ArrayBuffer>,
    expiresAt?: number,
  ) => {
    if (!/^[a-f0-9]{32}\.(mp3|wav|m4a|ogg|aac)$/.test(object))
      throw new Error('音频存储编号无效。');
    const response = await fetch(new URL(`/v1/audio/${object}`, origin), {
      method,
      signal: AbortSignal.timeout(30000),
      headers: {
        Authorization: `Bearer ${env.MEDIA_GATEWAY_SECRET}`,
        ...(bytes
          ? {
              'Content-Length': String(bytes.length),
              'X-Audio-Expires': String(expiresAt),
              'Content-Type': 'application/octet-stream',
            }
          : {}),
      },
      ...(bytes ? { body: bytes } : {}),
    });
    if (!response.ok && !(method === 'DELETE' && response.status === 404)) {
      await response.body?.cancel();
      throw new Error(
        `音频临时存储${method === 'PUT' ? '上传' : '清理'}失败（${response.status}），请稍后重试。`,
      );
    }
    return response;
  };
  return {
    async put(object: string, bytes: Uint8Array<ArrayBuffer>, expiresAt: number) {
      const response = await request(object, 'PUT', bytes, expiresAt);
      const data = (await response.json()) as { url?: string };
      const url = new URL(data.url ?? '');
      if (
        url.origin !== origin.origin ||
        url.pathname !== `/v1/audio/${object}` ||
        !url.searchParams.has('signature') ||
        !url.searchParams.has('expires')
      )
        throw new Error('音频存储返回了无效的下载地址。');
      return url.href;
    },
    async remove(object: string) {
      const response = await request(object, 'DELETE');
      await response.body?.cancel();
    },
  };
}
