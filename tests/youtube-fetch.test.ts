import { afterEach, expect, it, vi } from 'vitest';
import { youtubeFetch, YoutubeSourceError } from '../src/server/youtube-fetch';
afterEach(() => vi.unstubAllGlobals());
const params = { url: 'https://www.youtube.com/watch?v=nykOeWgQcHM' };
it('reports 429 without retrying or mislabelling the video as removed', async () => {
  const request = vi.fn().mockResolvedValue(new Response('', { status: 429 }));
  vi.stubGlobal('fetch', request);
  await expect(youtubeFetch(params)).rejects.toMatchObject({ code: 'rate-limited' });
  expect(request).toHaveBeenCalledTimes(1);
});
it('stops on forbidden access', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 403 })));
  await expect(youtubeFetch(params)).rejects.toMatchObject({ code: 'restricted' });
});
it('recovers from a transient upstream failure and preserves request options', async () => {
  const request = vi
    .fn()
    .mockResolvedValueOnce(new Response('', { status: 503 }))
    .mockResolvedValueOnce(new Response('ok'));
  vi.stubGlobal('fetch', request);
  const response = await youtubeFetch({
    ...params,
    method: 'POST',
    body: '{}',
    headers: { 'Content-Type': 'application/json' },
  });
  expect(await response.text()).toBe('ok');
  expect(request).toHaveBeenCalledTimes(2);
  expect(request.mock.calls[1][1]).toMatchObject({ method: 'POST', body: '{}' });
});
it('bounds retries on network failure', async () => {
  const request = vi.fn().mockRejectedValue(new TypeError('connection closed'));
  vi.stubGlobal('fetch', request);
  await expect(youtubeFetch(params)).rejects.toBeInstanceOf(YoutubeSourceError);
  expect(request).toHaveBeenCalledTimes(2);
});
it('preserves caller cancellation without retry', async () => {
  const controller = new AbortController();
  controller.abort();
  const request = vi.fn().mockRejectedValue(controller.signal.reason);
  vi.stubGlobal('fetch', request);
  await expect(youtubeFetch({ ...params, signal: controller.signal })).rejects.toBe(
    controller.signal.reason,
  );
  expect(request).toHaveBeenCalledTimes(1);
});
