import { it, expect, vi, afterEach } from 'vitest';
import {
  SessionAudio,
  audioFormat,
  byteRange,
  maxAudioBytes,
  publicOrigin,
} from '../src/server/session/audio';
import type { StoredArticle } from '../src/server/session/types';
import { readBytes } from '../src/server/http';
afterEach(() => vi.useRealTimers());
function memory() {
  const data = new Map<string, unknown>();
  const api = {
    get: async (key: string) => structuredClone(data.get(key)),
    put: async (key: string, value: unknown) => {
      data.set(key, structuredClone(value));
    },
    delete: async (keys: string | string[]) => {
      for (const key of typeof keys === 'string' ? [keys] : keys) data.delete(key);
    },
    transaction: async (fn: (tx: unknown) => unknown) => fn(api),
  };
  const article = { id: 'a'.repeat(64), expiresAt: Date.now() + 86400000 } as StoredArticle;
  data.set('article', article);
  return { data, article, audio: new SessionAudio(api as unknown as DurableObjectStorage) };
}
function upload(bytes = new Uint8Array(1024).fill(7)) {
  bytes.set([73, 68, 51]);
  return new Request('https://internal/audio', {
    method: 'POST',
    headers: { 'X-Public-Origin': 'https://media.example.com', 'X-Audio-Filename': 'lecture.mp3' },
    body: bytes,
  });
}
function download(url: string, range?: string) {
  return new Request(`https://internal/audio-file?token=${url.split('/').at(-1)}`, {
    headers: range ? { Range: range } : {},
  });
}
it('protects the media with a random capability and invalidates replaced audio', async () => {
  const { audio, article } = memory();
  const first = (await audio.upload(upload(), article))!;
  expect((await audio.file(download(first.url.replace(/.$/, 'x')))).status).toBe(404);
  expect((await audio.file(download(first.url))).status).toBe(200);
  const second = (await audio.upload(upload(), article))!;
  expect(second.url).not.toBe(first.url);
  expect((await audio.file(download(first.url))).status).toBe(404);
});
it('serves precise ranges crossing storage chunks for seeking', async () => {
  const { audio, article } = memory();
  const bytes = new Uint8Array(1024 * 1024 + 100).map((_, i) => i % 251);
  const info = (await audio.upload(upload(bytes), article))!;
  const response = await audio.file(download(info.url, 'bytes=1048570-1048582'));
  expect(response.status).toBe(206);
  expect(response.headers.get('Content-Range')).toBe(`bytes 1048570-1048582/${bytes.length}`);
  expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes.slice(1048570, 1048583));
  expect((await audio.file(download(info.url, 'bytes=999999999-'))).status).toBe(416);
  const head = new Request(download(info.url), { method: 'HEAD' });
  expect(await (await audio.file(head)).text()).toBe('');
});
it('expires the capability and deletes stored bytes without touching the article', async () => {
  const { audio, article, data } = memory();
  const info = (await audio.upload(upload(), article))!;
  vi.useFakeTimers();
  vi.setSystemTime(info.expiresAt + 1);
  expect(await audio.info()).toBeNull();
  expect((await audio.file(download(info.url))).status).toBe(404);
  await audio.expire();
  expect([...data.keys()]).toEqual(['article']);
});
it('does not replace audio while the provider may still be downloading it', async () => {
  const { audio, article, data } = memory();
  data.set('recognition', { status: 'running' });
  await expect(audio.upload(upload(), article)).rejects.toThrow('停止等待');
  expect(data.has('audio')).toBe(false);
});
it('rejects disguised files, oversized streams and private callback origins', async () => {
  expect(() => audioFormat('test.mp3', new TextEncoder().encode('<html>page</html>'))).toThrow(
    '有效',
  );
  const wav = new Uint8Array([82, 73, 70, 70, 255, 0, 0, 0, 87, 65, 86, 69]);
  expect(audioFormat('test.wav', wav)).toBe('wav');
  for (const url of [
    'http://localhost:8787',
    'https://localhost',
    'https://a.example.com/path',
    'https://u:p@a.example.com',
  ])
    expect(() => publicOrigin(url)).toThrow();
  await expect(
    readBytes(
      new Request('https://internal', { method: 'POST', body: new Uint8Array(maxAudioBytes + 1) }),
      maxAudioBytes,
      'too big',
    ),
  ).rejects.toThrow('too big');
});
it('supports suffix and open-ended ranges but rejects multiple or empty ranges', () => {
  expect(byteRange('bytes=-5', 10)).toEqual([5, 9]);
  expect(byteRange('bytes=5-', 10)).toEqual([5, 9]);
  expect(byteRange('bytes=0-500', 10)).toEqual([0, 9]);
  for (const value of [
    'bytes=-0',
    'bytes=-',
    'bytes=4-2',
    'bytes=0-1,3-4',
    'bytes=9999999999999999999-',
  ])
    expect(byteRange(value, 10)).toBeNull();
});
