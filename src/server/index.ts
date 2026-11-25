import { DurableObject } from 'cloudflare:workers';
import { splitArticle, validateSummary, type Article, type Source, type Summary } from '../shared';
import { generate, articleSystem, summarySystem, type AIEnv } from './ai';
import { getSource, sourceText } from './transcript';
interface Env extends AIEnv {
  ASSETS: Fetcher;
  SESSIONS: DurableObjectNamespace<ArticleSession>;
  QUOTAS: DurableObjectNamespace<Quota>;
  APP_ACCESS_TOKEN?: string;
}
type Stored = Article & { source: Source; summaries: Record<string, Summary> };
const ttl = 24 * 60 * 60 * 1000;
const json = (data: unknown, status = 200) =>
  Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
async function body(request: Request): Promise<Record<string, unknown>> {
  if (!request.body) throw new Error('请求内容为空。');
  const reader = request.body.getReader();
  let bytes = 0;
  const parts: Uint8Array[] = [];
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    bytes += value.length;
    if (bytes > 450_000) {
      await reader.cancel();
      throw new Error('请求过大，请缩短字幕。');
    }
    parts.push(value);
  }
  const buffer = new Uint8Array(bytes);
  let offset = 0;
  for (const part of parts) {
    buffer.set(part, offset);
    offset += part.length;
  }
  const result = JSON.parse(new TextDecoder().decode(buffer));
  if (!result || typeof result !== 'object' || Array.isArray(result))
    throw new Error('请求格式不正确。');
  return result;
}
const message = (e: unknown) => (e instanceof Error ? e.message : '操作失败，请稍后重试。');
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    let response: Response;
    try {
      if (!url.pathname.startsWith('/api/')) response = await env.ASSETS.fetch(request);
      else if (request.method === 'GET' && url.pathname === '/api/config')
        response = json({
          provider: env.AI_PROVIDER,
          model: env.AI_MODEL,
          accessRequired: !!env.APP_ACCESS_TOKEN,
          configured: !!(env.AI_PROVIDER === 'gemini' ? env.GEMINI_API_KEY : env.ZHIPU_API_KEY),
        });
      else {
        if (request.headers.get('origin') && request.headers.get('origin') !== url.origin)
          return json({ error: '请从本站发起请求。' }, 403);
        if (env.APP_ACCESS_TOKEN && request.headers.get('X-Access-Code') !== env.APP_ACCESS_TOKEN)
          return json({ error: '请输入正确的访问码。' }, 401);
        if (url.pathname === '/api/generate' && request.method === 'POST') {
          const input = await body(request);
          if (!['youtube', 'sample', 'manual'].includes(String(input.mode)))
            return json({ error: '请选择字幕来源。' }, 400);
          if (typeof input.requirements !== 'string' || input.requirements.length > 2000)
            return json({ error: '生成要求最多 2,000 字。' }, 400);
          if (
            (input.mode === 'youtube' && typeof input.url !== 'string') ||
            (input.mode === 'manual' && typeof input.transcript !== 'string')
          )
            return json({ error: '请填写视频链接或字幕。' }, 400);
          const quota = await env.QUOTAS.get(
            env.QUOTAS.idFromName(request.headers.get('CF-Connecting-IP') ?? 'local'),
          ).fetch(new Request('https://internal/consume', { method: 'POST' }));
          if (!quota.ok) return quota;
          const id = Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) =>
            byte.toString(16).padStart(2, '0'),
          ).join('');
          response = await env.SESSIONS.get(env.SESSIONS.idFromName(id)).fetch(
            new Request(`https://internal/generate?id=${id}`, {
              method: 'POST',
              body: JSON.stringify(input),
            }),
          );
        } else {
          const match = /^\/api\/sessions\/([a-f0-9]{64})(?:\/(summary|cancel))?$/.exec(
            url.pathname,
          );
          if (!match) return json({ error: '接口不存在。' }, 404);
          const [, id, action] = match;
          if (
            (action && request.method !== 'POST') ||
            (!action && !['GET', 'DELETE'].includes(request.method))
          )
            return json({ error: '请求方法不支持。' }, 405);
          const payload = action === 'summary' ? await body(request) : undefined;
          response = await env.SESSIONS.get(env.SESSIONS.idFromName(id)).fetch(
            new Request(`https://internal/${action ?? 'article'}`, {
              method: request.method,
              ...(payload ? { body: JSON.stringify(payload) } : {}),
            }),
          );
        }
      }
    } catch (e) {
      response = json({ error: message(e) }, 400);
    }
    const headers = new Headers(response.headers);
    headers.set('X-Content-Type-Options', 'nosniff');
    headers.set('Referrer-Policy', 'no-referrer');
    headers.set(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
    );
    return new Response(response.body, { status: response.status, headers });
  },
} satisfies ExportedHandler<Env>;
export class Quota extends DurableObject<Env> {
  async fetch() {
    const now = Date.now();
    const slot = Math.floor(now / 3600000);
    const current = await this.ctx.storage.get<{ slot: number; count: number }>('quota');
    const count = current?.slot === slot ? current.count + 1 : 1;
    if (count > 12) return json({ error: '本小时生成次数已达上限，请稍后再试。' }, 429);
    await this.ctx.storage.put('quota', { slot, count });
    await this.ctx.storage.setAlarm(now + 3600000);
    return json({ ok: true });
  }
  async alarm() {
    await this.ctx.storage.deleteAll();
  }
}
export class ArticleSession extends DurableObject<Env> {
  private aborter?: AbortController;
  private deleted = false;
  private pending = new Map<string, Promise<Summary>>();
  async alarm() {
    this.aborter?.abort();
    await this.ctx.storage.deleteAll();
  }
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/generate') {
      const input = (await request.json()) as {
        mode: string;
        url?: string;
        transcript?: string;
        requirements: string;
      };
      const id = url.searchParams.get('id')!;
      this.aborter = new AbortController();
      const signal = this.aborter.signal;
      const timeout = setTimeout(() => this.aborter?.abort(), 180000);
      let record: Stored | undefined;
      const encoder = new TextEncoder();
      const stream = new ReadableStream<Uint8Array>({
        start: (controller) => {
          let connected = true;
          const emit = (event: string, data: unknown) => {
            if (connected) {
              try {
                controller.enqueue(
                  encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
                );
              } catch {
                connected = false;
                this.aborter?.abort();
              }
            }
          };
          const pulse = setInterval(() => emit('heartbeat', {}), 10000);
          this.ctx.waitUntil(
            (async () => {
              try {
                emit('session', { id });
                emit('status', { message: '正在读取字幕' });
                const source = await getSource(
                  input,
                  AbortSignal.any([signal, AbortSignal.timeout(30000)]),
                );
                signal.throwIfAborted();
                record = {
                  id,
                  source,
                  requirements: input.requirements,
                  markdown: '',
                  chapters: [],
                  summaries: {},
                  status: 'generating',
                  createdAt: Date.now(),
                  expiresAt: Date.now() + ttl,
                };
                await this.ctx.storage.put('article', record);
                await this.ctx.storage.setAlarm(record.expiresAt);
                emit('source', { ...source, captions: undefined });
                emit('status', { message: '正在整理文章' });
                const prompt = JSON.stringify({
                  videoId: source.videoId ?? null,
                  title: source.title,
                  userRequirements: input.requirements || '按主题整理为中文对话文章。',
                  transcript: sourceText(source),
                });
                let checkpoint = Date.now();
                for await (const delta of generate(this.env, articleSystem, prompt, signal)) {
                  record.markdown += delta;
                  if (record.markdown.length > 100_000)
                    throw new Error('文章超出长度限制，请缩短生成要求。');
                  emit('delta', { text: delta });
                  if (Date.now() - checkpoint > 2000) {
                    await this.ctx.storage.put('article', record);
                    checkpoint = Date.now();
                  }
                }
                record.chapters = splitArticle(record.markdown);
                if (!record.chapters.length) throw new Error('模型未生成章节结构，请重新生成。');
                record.status = 'complete';
                await this.ctx.storage.put('article', record);
                emit('done', { chapters: record.chapters, expiresAt: record.expiresAt });
              } catch (e) {
                if (record && !this.deleted) {
                  record.status = 'interrupted';
                  record.chapters = splitArticle(record.markdown);
                  await this.ctx.storage.put('article', record);
                }
                emit('error', {
                  message: signal.aborted ? '生成已停止，已生成内容会保留。' : message(e),
                });
              } finally {
                clearTimeout(timeout);
                clearInterval(pulse);
                try {
                  controller.close();
                } catch {}
                this.aborter = undefined;
              }
            })(),
          );
        },
        cancel: () => this.aborter?.abort(),
      });
      return new Response(stream, {
        headers: {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
          'X-Accel-Buffering': 'no',
        },
      });
    }
    if (url.pathname === '/cancel') {
      this.aborter?.abort();
      return json({ ok: true });
    }
    const stored = await this.ctx.storage.get<Stored>('article');
    if (!stored || stored.expiresAt < Date.now())
      return json({ error: '这篇文章已过期或不存在，请重新生成。' }, 404);
    if (request.method === 'DELETE') {
      this.deleted = true;
      this.aborter?.abort();
      await this.ctx.storage.deleteAll();
      return json({ ok: true });
    }
    if (url.pathname === '/article') {
      // Recover a checkpoint if the generating isolate terminated unexpectedly.
      if (stored.status === 'generating' && !this.aborter) {
        stored.status = 'interrupted';
        stored.chapters = splitArticle(stored.markdown);
        await this.ctx.storage.put('article', stored);
      }
      return json({ ...stored, source: { ...stored.source, captions: undefined } });
    }
    if (url.pathname !== '/summary') return json({ error: '接口不存在。' }, 404);
    if (stored.status !== 'complete') return json({ error: '文章完整生成后才能总结。' }, 409);
    const input = (await request.json()) as { chapterId?: string };
    const chapter = stored.chapters.find((c) => c.id === input.chapterId);
    if (!chapter) return json({ error: '章节不存在。' }, 404);
    if (stored.summaries[chapter.id]) return json(stored.summaries[chapter.id]);
    try {
      let pending = this.pending.get(chapter.id);
      if (!pending) {
        if (this.pending.size >= 2) return json({ error: '请等待当前章节总结完成。' }, 429);
        pending = (async () => {
          let text = '';
          for await (const delta of generate(
            this.env,
            summarySystem,
            JSON.stringify({
              transcript: sourceText(stored.source),
              article: stored.markdown,
              currentChapter: chapter,
            }),
            AbortSignal.timeout(60000),
            true,
          ))
            text += delta;
          const summary = validateSummary(
            JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, '')),
          );
          await this.ctx.storage.transaction(async (txn) => {
            const latest = await txn.get<Stored>('article');
            if (latest && latest.expiresAt > Date.now()) {
              latest.summaries[chapter.id] = summary;
              await txn.put('article', latest);
            }
          });
          return summary;
        })();
        this.pending.set(chapter.id, pending);
      }
      return json(await pending);
    } catch (e) {
      return json({ error: message(e) }, 502);
    } finally {
      this.pending.delete(chapter.id);
    }
  }
}
