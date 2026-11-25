import { afterEach, expect, it, vi } from 'vitest';
import { supadataSource } from '../src/server/supadata';
const transcript = {
  content: [{ text: 'A real caption.', offset: 1250, duration: 2400 }],
  lang: 'en',
};
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
const load = () => supadataSource('aircAruvnKk', 'server-secret', new AbortController().signal);
it('fetches native timestamped captions, converts milliseconds and records provenance', async () => {
  const request = vi
    .fn()
    .mockResolvedValueOnce(Response.json(transcript))
    .mockResolvedValueOnce(Response.json({ title: 'Neural networks' }));
  vi.stubGlobal('fetch', request);
  const source = await load();
  const url = new URL(request.mock.calls[0][0]);
  expect(url.searchParams.get('mode')).toBe('native');
  expect(url.searchParams.get('text')).toBe('false');
  expect(url.searchParams.get('url')).toBe('https://www.youtube.com/watch?v=aircAruvnKk');
  expect(source).toMatchObject({
    title: 'Neural networks',
    provider: 'youtube',
    retrievedBy: 'supadata',
    trackType: 'unknown',
  });
  expect(source.captions[0]).toMatchObject({ id: 'c0001', offset: 1.25, duration: 2.4 });
  expect(request.mock.calls[1][1].headers).toBeUndefined(); // Never send the API key to YouTube.
});
it.each([
  [206, 'unavailable'],
  [401, 'configuration'],
  [402, 'configuration'],
  [403, 'restricted'],
  [429, 'rate-limited'],
  [502, 'upstream'],
])('classifies HTTP %s without retry or exposing provider bodies', async (status, code) => {
  const request = vi
    .fn()
    .mockResolvedValue(new Response('sensitive provider details', { status: Number(status) }));
  vi.stubGlobal('fetch', request);
  await expect(load()).rejects.toMatchObject({ code });
  expect(request).toHaveBeenCalledTimes(1);
});
it.each([null, {}, { content: [] }, { content: [{ text: 'Missing timestamps' }] }])(
  'rejects malformed or empty responses: %j',
  async (data) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(data)));
    await expect(load()).rejects.toThrow();
  },
);
it('keeps valid captions when optional metadata fails', async () => {
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValueOnce(Response.json(transcript))
      .mockRejectedValueOnce(new Error('metadata unreachable')),
  );
  expect((await load()).title).toBe('YouTube · aircAruvnKk');
});
it.each([false, true])(
  'polls native jobs without resubmitting a billable request (nested=%s)',
  async (nested) => {
    vi.useFakeTimers();
    const request = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ jobId: 'job-1' }, { status: 202 }))
      .mockResolvedValueOnce(Response.json({ status: 'active' }))
      .mockResolvedValueOnce(
        Response.json(
          nested
            ? { status: 'completed', result: transcript }
            : { status: 'completed', ...transcript },
        ),
      )
      .mockResolvedValueOnce(Response.json({ title: 'Lecture' }));
    vi.stubGlobal('fetch', request);
    const pending = load();
    await vi.advanceTimersByTimeAsync(2200);
    expect((await pending).captions).toHaveLength(1);
    expect(request.mock.calls[1][0]).toBe('https://api.supadata.ai/v1/transcript/job-1');
    expect(request.mock.calls[2][0]).toBe(request.mock.calls[1][0]);
  },
);
it('honors cancellation while a native job is queued', async () => {
  vi.useFakeTimers();
  const request = vi.fn().mockResolvedValue(Response.json({ jobId: 'job-1' }, { status: 202 }));
  vi.stubGlobal('fetch', request);
  const aborter = new AbortController();
  const pending = supadataSource('aircAruvnKk', 'server-secret', aborter.signal);
  const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  await vi.advanceTimersByTimeAsync(10);
  aborter.abort();
  await rejected;
  expect(request).toHaveBeenCalledTimes(1);
});
