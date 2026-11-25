import { fetchTranscript, type FetchParams } from 'youtube-transcript-plus';
import type { Source } from '../shared';
import { normalizeCaptions } from '../domain/captions';
import { youtubeFetch, YoutubeSourceError } from './youtube-fetch';
// Observe the selected track in the existing player request; no second network lookup.
export async function youtubeSource(id: string, signal: AbortSignal): Promise<Source> {
  let trackType: Source['trackType'] = 'unknown';
  const result = await fetchTranscript(id, {
    signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
    videoDetails: true,
    videoFetch: async (params) => {
      const response = await youtubeFetch(params);
      if ((await response.clone().text()).includes('class="g-recaptcha"'))
        throw new YoutubeSourceError('restricted');
      return response;
    },
    transcriptFetch: youtubeFetch,
    playerFetch: async (params: FetchParams) => {
      const response = await youtubeFetch(params);
      if (response.ok) {
        const player = (await response.clone().json()) as {
          playabilityStatus?: { status?: string };
          captions?: { playerCaptionsTracklistRenderer?: { captionTracks?: { kind?: string }[] } };
        };
        if (
          ['LOGIN_REQUIRED', 'AGE_CHECK_REQUIRED'].includes(player.playabilityStatus?.status ?? '')
        )
          throw new YoutubeSourceError('restricted');
        const track = player.captions?.playerCaptionsTracklistRenderer?.captionTracks?.[0];
        if (track) trackType = track.kind === 'asr' ? 'automatic' : 'manual';
      }
      return response;
    },
  });
  if (!result.segments.length) throw new YoutubeSourceError('empty');
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
