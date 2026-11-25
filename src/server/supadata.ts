import type { Source } from '../shared';
import { normalizeCaptions } from '../domain/captions';

export class TranscriptServiceError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'TranscriptServiceError';
  }
}
const fail = (code: string, message: string): never => {
  throw new TranscriptServiceError(code, message);
};
const endpoint = 'https://api.supadata.ai/v1/transcript';

// Native mode never silently switches from existing captions to paid audio transcription.
export async function supadataSource(
  id: string,
  key: string,
  signal: AbortSignal,
): Promise<Source> {
  const bounded = AbortSignal.any([signal, AbortSignal.timeout(30_000)]);
  const request = async (url: string) => {
    let response: Response;
    try {
      response = await fetch(url, { headers: { 'x-api-key': key }, signal: bounded });
    } catch (error) {
      if (signal.aborted) throw error;
      return fail('network', '字幕服务连接超时或暂时失败，请稍后重试。');
    }
    if ([401, 402].includes(response.status))
      return fail('configuration', '字幕服务的密钥或额度不可用，请联系维护者检查配置。');
    if (response.status === 429)
      return fail('rate-limited', '字幕服务请求过于频繁或额度已用尽，请稍后重试。');
    if ([206, 404].includes(response.status))
      return fail('unavailable', '未能读取此视频的现有字幕，请确认视频公开且有字幕。');
    if (response.status === 403)
      return fail('restricted', '此视频的字幕访问受限，当前无法自动读取。');
    if (!response.ok) return fail('upstream', '字幕服务暂时不可用，请稍后重试。');
    let data;
    try {
      data = (await response.json()) as Record<string, unknown>;
    } catch {
      return fail('invalid-response', '字幕服务返回的数据无效，请稍后重试。');
    }
    if (!data || typeof data !== 'object' || Array.isArray(data))
      return fail('invalid-response', '字幕服务返回的数据无效，请稍后重试。');
    return { data, status: response.status };
  };
  const url = new URL(endpoint);
  url.search = new URLSearchParams({
    url: `https://www.youtube.com/watch?v=${id}`,
    mode: 'native',
    text: 'false',
  }).toString();
  let result = await request(url.href);
  if (result.status === 202) {
    const jobId = result.data.jobId;
    if (typeof jobId !== 'string' || !/^[\w-]{1,128}$/.test(jobId))
      return fail('invalid-response', '字幕服务返回的任务无效，请稍后重试。');
    do {
      try {
        await delay(bounded);
      } catch (error) {
        if (signal.aborted) throw error;
        return fail('network', '字幕读取任务超时，请稍后重试。');
      }
      result = await request(`${endpoint}/${jobId}`);
      if (result.data.status === 'failed')
        return fail('upstream', '字幕读取任务失败，请稍后重试。');
    } while (['queued', 'active'].includes(String(result.data.status)));
    // Current SDK responses nest the result; the REST docs also describe a flat result.
    if (result.data.result && typeof result.data.result === 'object')
      result.data = result.data.result as Record<string, unknown>;
  }
  const { content, lang } = result.data;
  if (!Array.isArray(content) || !content.length)
    return fail('empty', '此视频没有可读取的现有字幕。');
  if (content.length > 6000) throw new Error('字幕最多支持 100,000 字，请分段整理。');
  const captions = normalizeCaptions(
    content.map((cue) => {
      if (
        !cue ||
        typeof cue.text !== 'string' ||
        typeof cue.offset !== 'number' ||
        typeof cue.duration !== 'number'
      )
        return fail('invalid-response', '字幕服务返回的时间轴无效，请稍后重试。');
      return { text: cue.text, offset: cue.offset / 1000, duration: cue.duration / 1000 };
    }),
  );
  let title = `YouTube · ${id}`;
  try {
    const metadata = await fetch(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${id}`)}&format=json`,
      {
        signal: AbortSignal.any([bounded, AbortSignal.timeout(3000)]),
      },
    );
    if (metadata.ok) {
      const data = (await metadata.json()) as { title?: unknown };
      if (typeof data.title === 'string' && data.title.trim()) title = data.title.slice(0, 500);
    }
  } catch {
    /* A missing title must not discard valid captions. */
  }
  signal.throwIfAborted();
  return {
    kind: 'youtube',
    provider: 'youtube',
    videoId: id,
    title,
    sourceUrl: `https://www.youtube.com/watch?v=${id}`,
    language: typeof lang === 'string' ? lang : undefined,
    trackType: 'unknown',
    retrievedBy: 'supadata',
    notice: '已通过 Supadata 读取此视频的现有字幕，未进行音频转录。',
    captions,
  };
}
function delay(signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort);
      resolve();
    }, 1000);
    signal.addEventListener('abort', abort, { once: true });
  });
}
