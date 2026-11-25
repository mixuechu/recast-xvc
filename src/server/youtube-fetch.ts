import type { FetchParams } from 'youtube-transcript-plus';

export type YoutubeFailure = 'rate-limited' | 'restricted' | 'network' | 'unavailable' | 'empty';
const messages: Record<YoutubeFailure, string> = {
  'rate-limited': 'YouTube 暂时拒绝了服务器的请求（429），请稍后重试，或导入该视频的字幕。',
  restricted: 'YouTube 要求登录或人机验证，当前无法自动读取。请导入该视频的字幕。',
  network: '连接 YouTube 超时或暂时失败，请重试，或导入该视频的字幕。',
  unavailable: '当前无法读取该视频的公开字幕，请确认视频可公开访问，或导入字幕。',
  empty: 'YouTube 返回了空字幕，请导入字幕后继续。',
};
export class YoutubeSourceError extends Error {
  constructor(readonly code: YoutubeFailure) {
    super(messages[code]);
    this.name = 'YoutubeSourceError';
  }
}

// Retry a transient upstream failure once; a challenge or 429 requires stopping.
export async function youtubeFetch(params: FetchParams): Promise<Response> {
  const { url, method, body, headers, userAgent, lang, signal } = params;
  const bounded = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(12_000)]);
  for (let attempt = 0; ; attempt++) {
    let response: Response;
    try {
      response = await fetch(url, {
        method,
        body,
        signal: bounded,
        headers: {
          ...headers,
          ...(userAgent ? { 'User-Agent': userAgent } : {}),
          ...(lang ? { 'Accept-Language': lang } : {}),
        },
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      if (!attempt && !bounded.aborted) continue;
      throw new YoutubeSourceError('network');
    }
    if (response.status === 429) throw new YoutubeSourceError('rate-limited');
    if (response.status === 403) throw new YoutubeSourceError('restricted');
    if (response.status >= 500) {
      await response.body?.cancel();
      if (!attempt) continue;
      throw new YoutubeSourceError('network');
    }
    return response;
  }
}
