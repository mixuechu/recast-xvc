import { fetchTranscript, type FetchParams } from 'youtube-transcript-plus';
import type { Source } from '../shared';
import { normalizeCaptions } from '../domain/captions';
// Observe the selected track in the existing player request; no second network lookup.
export async function youtubeSource(id: string, signal: AbortSignal): Promise<Source> {
  let trackType: Source['trackType'] = 'unknown';
  const result = await fetchTranscript(id, {
    signal,
    videoDetails: true,
    playerFetch: async ({ url, method, body, headers, userAgent, lang, signal }: FetchParams) => {
      const response = await fetch(url, {
        method,
        body,
        signal,
        headers: {
          ...headers,
          ...(userAgent ? { 'User-Agent': userAgent } : {}),
          ...(lang ? { 'Accept-Language': lang } : {}),
        },
      });
      if (response.ok) {
        const player = (await response.clone().json()) as {
          captions?: { playerCaptionsTracklistRenderer?: { captionTracks?: { kind?: string }[] } };
        };
        const track = player.captions?.playerCaptionsTracklistRenderer?.captionTracks?.[0];
        if (track) trackType = track.kind === 'asr' ? 'automatic' : 'manual';
      }
      return response;
    },
  });
  return {
    kind: 'youtube',
    videoId: id,
    title: result.videoDetails.title,
    provider: 'youtube',
    sourceUrl: `https://www.youtube.com/watch?v=${id}`,
    language: result.segments[0]?.lang,
    trackType,
    captions: normalizeCaptions(result.segments),
  };
}
