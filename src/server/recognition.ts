import type { Caption } from '../shared';
import { normalizeCaptions } from '../domain/captions';
export type RecognitionEnv = { VOLC_ASR_API_KEY?: string; VOLC_ASR_RESOURCE_ID?: string };
const endpoint = 'https://openspeech.bytedance.com/api/v3/auc/bigmodel/';
export function publicAudioUrl(value: unknown, format?: string): string {
  if (
    format !== undefined &&
    (typeof format !== 'string' ||
      !['wav', 'mp3', 'ogg', 'm4a', 'aac', 'amr', 'spx'].includes(format))
  )
    throw new Error('请选择支持的音频格式。');
  if (typeof value !== 'string' || value.length > 4096)
    throw new Error('请输入可公开下载的音频链接。');
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('音频链接无效。');
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.port ||
    url.hostname === 'localhost' ||
    url.hostname.endsWith('.local') ||
    url.hostname.endsWith('.internal') ||
    !url.hostname.includes('.') ||
    /^\d+\.\d+\.\d+\.\d+$/.test(url.hostname) ||
    url.hostname.includes(':')
  )
    throw new Error('请使用公网 HTTPS 音频链接，不支持本地或私网地址。');
  if (
    !/\.(wav|mp3|ogg|m4a|aac|amr|spx)$/i.test(url.pathname) &&
    !['wav', 'mp3', 'ogg', 'm4a', 'aac', 'amr', 'spx'].includes(format ?? '')
  )
    throw new Error('音频链接需指向 wav、mp3、ogg、m4a、aac、amr 或 spx 文件。');
  return url.href;
}
function headers(env: RecognitionEnv, id: string) {
  if (!env.VOLC_ASR_API_KEY)
    throw new Error('尚未配置火山录音识别密钥；可先导入第二份字幕进行校对。');
  return {
    'Content-Type': 'application/json',
    'X-Api-Key': env.VOLC_ASR_API_KEY,
    'X-Api-Resource-Id': env.VOLC_ASR_RESOURCE_ID ?? 'volc.seedasr.auc',
    'X-Api-Request-Id': id,
  };
}
async function request(env: RecognitionEnv, id: string, action: 'submit' | 'query', data: unknown) {
  const response = await fetch(endpoint + action, {
    method: 'POST',
    headers: { ...headers(env, id), ...(action === 'submit' ? { 'X-Api-Sequence': '-1' } : {}) },
    body: JSON.stringify(data),
    signal: AbortSignal.timeout(20000),
  });
  const code = response.headers.get('X-Api-Status-Code');
  if (!response.ok || !['20000000', '20000001', '20000002'].includes(code ?? '')) {
    await response.body?.cancel();
    if (code === '45000030' || response.status === 403)
      throw new Error('火山 ASR 未授权，请在控制台开通录音文件识别资源。');
    if (response.status === 429) throw new Error('火山识别请求较多，请稍后再试。');
    throw new Error(
      `火山录音识别失败（${code ?? response.status}），请检查音频可访问性与账户配置。`,
    );
  }
  return {
    code,
    data: (await response.json()) as {
      result?: {
        utterances?: {
          text: string;
          start_time: number;
          end_time: number;
          additions?: { speaker?: string };
        }[];
      };
    },
  };
}
export async function submitRecognition(
  env: RecognitionEnv,
  id: string,
  url: string,
  format?: string,
) {
  await request(env, id, 'submit', {
    user: { uid: 'recast' },
    audio: {
      url: publicAudioUrl(url, format),
      format: format ?? new URL(url).pathname.split('.').at(-1)!.toLowerCase(),
    },
    request: {
      model_name: 'bigmodel',
      show_utterances: true,
      enable_speaker_info: true,
      ssd_version: '200',
      enable_itn: true,
      enable_punc: true,
      enable_ddc: false,
    },
  });
}
export async function queryRecognition(
  env: RecognitionEnv,
  id: string,
  onPending?: (status: 'queued' | 'running') => void,
): Promise<Caption[] | null> {
  const result = await request(env, id, 'query', {});
  if (result.code !== '20000000') {
    onPending?.(result.code === '20000002' ? 'queued' : 'running');
    return null;
  }
  return normalizeCaptions(
    (result.data.result?.utterances ?? []).map((c) => ({
      text: c.text,
      offset: c.start_time / 1000,
      duration: (c.end_time - c.start_time) / 1000,
      speaker: c.additions?.speaker ? `讲者 ${c.additions.speaker}` : undefined,
    })),
  );
}
