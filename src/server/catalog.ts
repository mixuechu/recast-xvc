import type { Source } from '../shared';
import { parseCaptions, normalizeCaptions } from '../domain/captions';
import snapshot from './fixtures/mit-computation.json';
export const realExample = {
  videoId: 'nykOeWgQcHM',
  title: 'MIT · What is Computation?',
  page: 'https://ocw.mit.edu/courses/6-0001-introduction-to-computer-science-and-programming-in-python-fall-2016/resources/lecture-1-what-is-computation/',
  captions:
    'https://ocw.mit.edu/courses/6-0001-introduction-to-computer-science-and-programming-in-python-fall-2016/a746f6bc380f5e6d807ffff5f56cd877_nykOeWgQcHM.vtt',
};
// Only an explicitly verified mapping may use a publisher fallback. Never guess a video's source.
export async function publisherSource(
  id: string,
  signal: AbortSignal,
): Promise<Source | undefined> {
  if (id !== realExample.videoId) return;
  let captions: Source['captions'],
    retrieval: 'live' | 'snapshot' = 'live';
  try {
    const response = await fetch(realExample.captions, { signal });
    if (!response.ok) throw new Error('unavailable');
    captions = parseCaptions(await response.text());
  } catch (e) {
    if (signal.aborted) throw e;
    captions = normalizeCaptions(snapshot);
    retrieval = 'snapshot';
  }
  return {
    kind: 'youtube',
    videoId: id,
    title: realExample.title,
    provider: 'publisher',
    sourceUrl: realExample.page,
    language: 'en',
    trackType: 'manual',
    license: 'MIT OpenCourseWare · CC BY-NC-SA 4.0',
    notice:
      retrieval === 'live'
        ? '本次未能获取 YouTube 字幕，已使用同一视频的 MIT 官方字幕。'
        : 'YouTube 及发布方字幕暂不可用，已使用 MIT 官方字幕固定快照（2026-11-25）。',
    retrieval,
    captions,
  };
}
