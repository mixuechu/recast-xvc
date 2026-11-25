import { afterEach, expect, it, vi } from 'vitest';
import { youtubeSource } from '../src/server/youtube';
afterEach(() => vi.unstubAllGlobals());
const player = (status = 'OK') => ({
  playabilityStatus: { status },
  videoDetails: { title: 'Public lecture' },
  captions: {
    playerCaptionsTracklistRenderer: {
      captionTracks: [
        {
          baseUrl: 'https://www.youtube.com/api/timedtext?v=nykOeWgQcHM',
          languageCode: 'en',
          kind: 'asr',
        },
      ],
    },
  },
});
it('passes real library parsing through to normalized, attributed captions', async () => {
  const request = vi
    .fn()
    .mockResolvedValueOnce(new Response('"INNERTUBE_API_KEY":"public-key"'))
    .mockResolvedValueOnce(Response.json(player()))
    .mockResolvedValueOnce(
      new Response(
        '<transcript><text start="1.5" dur="2.0">Hello &amp; welcome.</text></transcript>',
      ),
    );
  vi.stubGlobal('fetch', request);
  const source = await youtubeSource('nykOeWgQcHM', new AbortController().signal);
  expect(source).toMatchObject({
    provider: 'youtube',
    trackType: 'automatic',
    language: 'en',
    title: 'Public lecture',
  });
  expect(source.captions[0]).toMatchObject({
    id: 'c0001',
    text: 'Hello & welcome.',
    offset: 1.5,
    duration: 2,
  });
});
it('does not call the player after a challenge page', async () => {
  const request = vi.fn().mockResolvedValue(new Response('<div class="g-recaptcha"></div>'));
  vi.stubGlobal('fetch', request);
  await expect(youtubeSource('nykOeWgQcHM', new AbortController().signal)).rejects.toMatchObject({
    code: 'restricted',
  });
  expect(request).toHaveBeenCalledTimes(1);
});
it('reports login requirements instead of claiming that captions are disabled', async () => {
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValueOnce(new Response('"INNERTUBE_API_KEY":"public-key"'))
      .mockResolvedValueOnce(Response.json(player('LOGIN_REQUIRED'))),
  );
  await expect(youtubeSource('nykOeWgQcHM', new AbortController().signal)).rejects.toMatchObject({
    code: 'restricted',
  });
});
