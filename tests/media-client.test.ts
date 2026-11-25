import { it, expect, vi, afterEach } from 'vitest';
import { mediaGateway } from '../src/server/media-gateway';
afterEach(() => vi.unstubAllGlobals());
const env = {
  MEDIA_GATEWAY_URL: 'https://media.example.com',
  MEDIA_GATEWAY_SECRET: 'server-only-'.repeat(4),
};
const object = 'a'.repeat(32) + '.mp3';
it('sends upload authorization only to the configured gateway and validates its download origin', async () => {
  const fetcher = vi.fn().mockResolvedValue(
    Response.json({
      url: `https://media.example.com/v1/audio/${object}?signature=test&expires=123`,
    }),
  );
  vi.stubGlobal('fetch', fetcher);
  const url = await mediaGateway(env)!.put(object, new Uint8Array(256), 123000);
  expect(url).toContain('signature=');
  expect(url).not.toContain(env.MEDIA_GATEWAY_SECRET);
  expect(fetcher.mock.calls[0][1].headers.Authorization).toBe(`Bearer ${env.MEDIA_GATEWAY_SECRET}`);
  fetcher.mockResolvedValue(
    Response.json({ url: 'https://other.example.com/file.mp3?signature=test&expires=123' }),
  );
  await expect(mediaGateway(env)!.put(object, new Uint8Array(256), 123000)).rejects.toThrow('无效');
});
it('rejects partial configuration and sanitizes remote upload failures', async () => {
  expect(mediaGateway({})).toBeNull();
  expect(() => mediaGateway({ MEDIA_GATEWAY_URL: env.MEDIA_GATEWAY_URL })).toThrow('不完整');
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('private body', { status: 403 })));
  await expect(mediaGateway(env)!.put(object, new Uint8Array(256), 123000)).rejects.toThrow('403');
});
