import type { AudioUpload, Recognition } from '../../shared';
import type { StoredArticle } from './types';
import { mediaGateway, type MediaGatewayEnv } from '../media-gateway';
import { readBytes } from '../http';
import { json } from '../http';
export const maxAudioBytes = 24 * 1024 * 1024;
const chunkSize = 1024 * 1024;
const retention = 3600000;
type StoredAudio = AudioUpload & { token: string; chunks: number; remoteObject?: string };
const mime: Record<string, string> = {
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
  ogg: 'audio/ogg',
  aac: 'audio/aac',
};
export function publicOrigin(value: string): string {
  const url = new URL(value);
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.port ||
    url.pathname !== '/' ||
    url.search ||
    url.hash ||
    url.hostname === 'localhost' ||
    url.hostname.endsWith('.local') ||
    url.hostname.endsWith('.internal') ||
    /^\d+\.\d+\.\d+\.\d+$/.test(url.hostname) ||
    url.hostname.includes(':') ||
    !url.hostname.includes('.')
  )
    throw new Error('本地音频上传需要公网回调地址，请先运行 npm run dev:asr。');
  return url.origin;
}
export function audioFormat(filename: string, bytes: Uint8Array): string {
  const format = filename.split('.').at(-1)?.toLowerCase() ?? '';
  const prefix = String.fromCharCode(...bytes.slice(0, 12));
  const valid =
    format === 'mp3'
      ? prefix.startsWith('ID3') || (bytes[0] === 255 && (bytes[1] & 224) === 224)
      : format === 'wav'
        ? prefix.startsWith('RIFF') && prefix.slice(8) === 'WAVE'
        : format === 'm4a'
          ? prefix.slice(4, 8) === 'ftyp'
          : format === 'ogg'
            ? prefix.startsWith('OggS')
            : format === 'aac'
              ? bytes[0] === 255 && (bytes[1] & 246) === 240
              : false;
  if (!valid) throw new Error('请选择有效的 MP3、WAV、M4A、OGG 或 AAC 音频文件。');
  return format;
}
export function byteRange(header: string | null, size: number): [number, number] | null {
  if (!header) return [0, size - 1];
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || (!match[1] && !match[2])) return null;
  const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
  const end = match[1] && match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
  return Number.isSafeInteger(start) &&
    Number.isSafeInteger(end) &&
    start >= 0 &&
    start <= end &&
    start < size
    ? [start, end]
    : null;
}
export class SessionAudio {
  constructor(
    private storage: DurableObjectStorage,
    private env: MediaGatewayEnv = {},
  ) {}
  async info(): Promise<AudioUpload | null> {
    const media = await this.storage.get<StoredAudio>('audio');
    if (!media || media.expiresAt <= Date.now()) return null;
    const { token: _token, chunks: _chunks, remoteObject: _remoteObject, ...info } = media;
    return info;
  }
  async upload(request: Request, article: StoredArticle) {
    const origin = publicOrigin(request.headers.get('X-Public-Origin') ?? '');
    const filename = decodeURIComponent(request.headers.get('X-Audio-Filename') ?? '').slice(
      0,
      180,
    );
    const bytes = await readBytes(request, maxAudioBytes, '音频最多支持 24 MB。');
    if (bytes.length < 256) throw new Error('音频文件为空或过短。');
    const format = audioFormat(filename, bytes);
    const token = crypto.randomUUID().replaceAll('-', '');
    const media: StoredAudio = {
      token,
      filename,
      format,
      size: bytes.length,
      chunks: Math.ceil(bytes.length / chunkSize),
      expiresAt: Math.min(Date.now() + retention, article.expiresAt),
      url: `${origin}/api/audio/${article.id}/${token}`,
    };
    const gateway = mediaGateway(this.env);
    const previous = await this.storage.get<StoredAudio>('audio');
    const task = await this.storage.get<Recognition>('recognition');
    if (task && ['queued', 'running'].includes(task.status))
      throw new Error('请先停止等待当前识别，再替换音频。');
    if (gateway) {
      media.remoteObject = `${token}.${format}`;
      media.url = await gateway.put(media.remoteObject, bytes, media.expiresAt);
      media.chunks = 0;
    }
    try {
      await this.storage.transaction(async (tx) => {
        const current = await tx.get<StoredArticle>('article');
        const task = await tx.get<Recognition>('recognition');
        if (!current || current.expiresAt <= Date.now())
          throw new Error('文章已过期，请重新生成。');
        if (task && ['queued', 'running'].includes(task.status))
          throw new Error('请先停止等待当前识别，再替换音频。');
        const old = await tx.get<StoredAudio>('audio');
        if (old?.token !== previous?.token) throw new Error('音轨已更新，请刷新面板后重试。');
        if (old?.chunks)
          await tx.delete(Array.from({ length: old.chunks }, (_, i) => `audio:${i}`));
        for (let i = 0; i < media.chunks; i++)
          await tx.put(`audio:${i}`, bytes.slice(i * chunkSize, (i + 1) * chunkSize));
        await tx.put('audio', media);
      });
    } catch (error) {
      if (media.remoteObject) await gateway?.remove(media.remoteObject).catch(() => {});
      throw error;
    }
    if (previous?.remoteObject) await gateway?.remove(previous.remoteObject).catch(() => {});
    return this.info();
  }
  async destroy() {
    const media = await this.storage.get<StoredAudio>('audio');
    if (media?.remoteObject) {
      const gateway = mediaGateway(this.env);
      if (!gateway) throw new Error('音频存储配置缺失，暂时无法清理音轨。');
      await gateway.remove(media.remoteObject);
    }
  }
  async expire() {
    await this.storage.transaction(async (tx) => {
      const media = await tx.get<StoredAudio>('audio');
      if (media && media.expiresAt <= Date.now()) {
        if (media.chunks)
          await tx.delete(Array.from({ length: media.chunks }, (_, i) => `audio:${i}`));
        await tx.delete('audio');
      }
    });
  }
  async file(request: Request): Promise<Response> {
    return this.storage.transaction(async (tx) => {
      const media = await tx.get<StoredAudio>('audio');
      if (
        !media ||
        media.expiresAt <= Date.now() ||
        new URL(request.url).searchParams.get('token') !== media.token
      )
        return json({ error: '音频不存在或已过期。' }, 404);
      if (media.remoteObject)
        return new Response(null, {
          status: 302,
          headers: { Location: media.url, 'Cache-Control': 'no-store' },
        });
      const range = byteRange(request.headers.get('Range'), media.size);
      if (!range)
        return new Response(null, {
          status: 416,
          headers: { 'Content-Range': `bytes */${media.size}` },
        });
      const [start, end] = range;
      const headers = new Headers({
        'Content-Type': mime[media.format],
        'Content-Length': String(end - start + 1),
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      });
      const partial = request.headers.has('Range');
      if (partial) headers.set('Content-Range', `bytes ${start}-${end}/${media.size}`);
      if (request.method === 'HEAD')
        return new Response(null, { status: partial ? 206 : 200, headers });
      const parts: Uint8Array<ArrayBuffer>[] = [];
      for (let i = Math.floor(start / chunkSize); i <= Math.floor(end / chunkSize); i++) {
        const part = await tx.get<Uint8Array>(`audio:${i}`);
        if (!part) throw new Error('音频已清理，请重新上传。');
        parts.push(
          part.slice(
            Math.max(0, start - i * chunkSize),
            Math.min(part.length, end - i * chunkSize + 1),
          ),
        );
      }
      // A Blob has a known length, so the runtime can preserve Content-Length
      // for media duration and seeking. Total file size is bounded at 24 MB.
      return new Response(new Blob(parts), { status: partial ? 206 : 200, headers });
    });
  }
}
