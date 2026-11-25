import { it, expect, vi, afterEach } from 'vitest';
import { fetchTranscript } from 'youtube-transcript-plus';
import { youtubeSource } from '../src/server/youtube';
vi.mock('youtube-transcript-plus', () => ({ fetchTranscript: vi.fn() }));
afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});
for (const [kind, expected] of [
  ['asr', 'automatic'],
  [undefined, 'manual'],
] as const) {
  it(`labels the track selected by the transcript adapter as ${expected}`, async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        Response.json({
          captions: { playerCaptionsTracklistRenderer: { captionTracks: [{ kind }] } },
        }),
      ),
    );
    vi.mocked(fetchTranscript).mockImplementation(async (_id, config) => {
      await config!.playerFetch!({
        url: 'https://www.youtube.com/youtubei/v1/player',
        method: 'POST',
        body: '{}',
      });
      return {
        videoDetails: { title: 'Actual video' },
        segments: [{ text: 'Original.', offset: 0, duration: 2, lang: 'en' }],
      } as never;
    });
    expect((await youtubeSource('nykOeWgQcHM', new AbortController().signal)).trackType).toBe(
      expected,
    );
    expect(fetch).toHaveBeenCalledTimes(1);
  });
}
it('does not guess a manual track when metadata is absent', async () => {
  vi.mocked(fetchTranscript).mockResolvedValue({
    videoDetails: { title: 'Video' },
    segments: [{ text: 'Original.', offset: 0, duration: 2, lang: 'en' }],
  } as never);
  expect((await youtubeSource('nykOeWgQcHM', new AbortController().signal)).trackType).toBe(
    'unknown',
  );
});
