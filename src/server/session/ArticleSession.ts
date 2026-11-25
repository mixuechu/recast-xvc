import { DurableObject } from 'cloudflare:workers';
import { splitArticle, type CitedSummary } from '../../shared';
import { normalizeCaptions } from '../../domain/captions';
import { validCitations, citationIds } from '../../domain/evidence';
import { generate, articleSystem } from '../ai';
import { getSource, sourceText } from '../transcript';
import { json, message } from '../http';
import type { Env } from '../env';
import type { StoredArticle, GenerateInput } from './types';
import { summarize } from './summarize';
import { ensureEvidence } from './ensure-evidence';
import { applyOutline } from '../../domain/outline';
import { requestedChapters, readableLength } from '../../domain/requirements';
import { requestedLength, withinLength, lengthDescription } from '../../domain/length';
import { fitLength } from './fit-length';
const ttl = 86400000;
export class ArticleSession extends DurableObject<Env> {
  private aborter?: AbortController;
  private deleted = false;
  private pending = new Map<string, Promise<CitedSummary>>();
  async alarm() {
    const article = await this.ctx.storage.get<StoredArticle>('article');
    if (!article || article.expiresAt <= Date.now()) {
      this.deleted = true;
      this.aborter?.abort();
      await this.ctx.storage.deleteAll();
      return;
    }
    await this.ctx.storage.setAlarm(article.expiresAt);
  }
  async fetch(request: Request): Promise<Response> {
    try {
      return await this.route(request);
    } catch (e) {
      return json({ error: message(e) }, 400);
    }
  }
  private async route(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/generate')
      return this.stream((await request.json()) as GenerateInput, url.searchParams.get('id')!);
    if (url.pathname === '/cancel') {
      this.aborter?.abort();
      return json({ ok: true });
    }
    const stored = await this.ctx.storage.get<StoredArticle>('article');
    if (!stored || stored.expiresAt <= Date.now())
      return json({ error: '这篇文章已过期或不存在，请重新生成。' }, 404);
    // v1 records remain readable; old summaries without evidence must be regenerated.
    if (stored.schemaVersion !== 2) {
      stored.schemaVersion = 2;
      stored.source.captions = normalizeCaptions(stored.source.captions);
      stored.summaries = {};
      await this.ctx.storage.put('article', stored);
    }
    if (url.pathname === '/article' && request.method === 'DELETE') {
      this.deleted = true;
      this.aborter?.abort();
      await this.ctx.storage.deleteAll();
      return json({ ok: true });
    }
    if (url.pathname === '/article') {
      if (stored.status === 'generating' && !this.aborter) {
        stored.status = 'interrupted';
        stored.chapters = splitArticle(stored.markdown);
        await this.ctx.storage.put('article', stored);
      }
      return json({ ...stored, source: { ...stored.source, captions: undefined } });
    }
    if (url.pathname === '/source') return json(stored.source);
    if (url.pathname === '/summary' && stored.status !== 'complete')
      return json({ error: '文章完整生成后才能总结。' }, 409);
    if (url.pathname === '/summary')
      return this.summary(stored, ((await request.json()) as { chapterId?: string }).chapterId);
    return json({ error: '接口不存在。' }, 404);
  }
  private async summary(stored: StoredArticle, chapterId?: string) {
    const chapter = stored.chapters.find((c) => c.id === chapterId);
    if (!chapter) return json({ error: '章节不存在。' }, 404);
    if (stored.summaries[chapter.id]) return json(stored.summaries[chapter.id]);
    let job = this.pending.get(chapter.id);
    if (!job) {
      if (this.pending.size >= 2) return json({ error: '请等待当前章节总结完成。' }, 429);
      job = (async () => {
        const result = await summarize(this.env, stored, chapter);
        await this.ctx.storage.transaction(async (tx) => {
          const latest = await tx.get<StoredArticle>('article');
          if (latest && latest.expiresAt > Date.now()) {
            latest.summaries[chapter.id] = result;
            await tx.put('article', latest);
          }
        });
        return result;
      })();
      this.pending.set(chapter.id, job);
      void job.finally(() => this.pending.delete(chapter.id)).catch(() => {});
    }
    try {
      return json(await job);
    } catch (e) {
      return json({ error: message(e) }, 502);
    }
  }
  private stream(input: GenerateInput, id: string) {
    if (this.aborter) return json({ error: '当前任务正在生成。' }, 409);
    this.aborter = new AbortController();
    const signal = this.aborter.signal;
    const timeout = setTimeout(() => this.aborter?.abort(), 300000);
    let record: StoredArticle | undefined;
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start: (controller) => {
        let connected = true;
        const emit = (event: string, data: unknown) => {
          if (!connected) return;
          try {
            controller.enqueue(
              encoder.encode(
                `event: ${event}\ndata: ${JSON.stringify({ type: event, ...(data as Record<string, unknown>) })}\n\n`,
              ),
            );
          } catch {
            connected = false;
            this.aborter?.abort();
          }
        };
        const heartbeat = setInterval(() => emit('heartbeat', {}), 10000);
        this.ctx.waitUntil(
          (async () => {
            try {
              emit('session', { id });
              const lengthBudget = requestedLength(input.requirements);
              emit('status', { message: '正在读取字幕' });
              const source = await getSource(
                input,
                AbortSignal.any([signal, AbortSignal.timeout(40000)]),
                this.env,
              );
              signal.throwIfAborted();
              record = {
                id,
                schemaVersion: 2,
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
                title: source.title,
                transcript: sourceText(source),
                requestedChapterCount: requestedChapters(input.requirements),
                lengthBudget: lengthBudget
                  ? { ...lengthBudget, allowed: lengthDescription(lengthBudget) }
                  : undefined,
                userRequirements:
                  input.requirements || '按主题整理为中文文章，保留讲者的论证与细节。',
                finalReminder:
                  '输出前检查本次生成要求，尤其是对话形式、篇幅与章节数量。用户指定的篇幅优先于默认长度，必要时压缩细节，不要因为保留对话而扩写。需要保留访谈时，用 **讲者：** 开头的真实问答，不得写成第三人称综述，也不得编造提问。每个正文段落（包括提问）末尾都必须附真实字幕引用，格式 [原文](#source-c0001)，编号取自字幕。',
              });
              let checkpoint = Date.now();
              for await (const delta of generate(this.env, articleSystem, prompt, signal)) {
                signal.throwIfAborted();
                record.markdown += delta;
                if (record.markdown.length > 100000)
                  throw new Error('文章超出长度限制，请缩短要求。');
                emit('delta', { text: delta });
                if (Date.now() - checkpoint > 2000) {
                  await this.ctx.storage.put('article', record);
                  checkpoint = Date.now();
                }
              }
              signal.throwIfAborted();
              emit('status', { message: '正在整理章节结构' });
              record.markdown = applyOutline(record.markdown, input.requirements);
              if (lengthBudget && !withinLength(readableLength(record.markdown), lengthBudget)) {
                emit('status', {
                  message: `正在调整篇幅（目标${lengthDescription(lengthBudget)}）`,
                });
                record.markdown = await fitLength(
                  this.env,
                  record.markdown,
                  input.requirements,
                  lengthBudget,
                  signal,
                );
              }
              emit('status', { message: '正在核对原文引用' });
              record.markdown = await ensureEvidence(this.env, source, record.markdown, signal);
              signal.throwIfAborted();
              record.chapters = splitArticle(record.markdown);
              if (!record.chapters.length) throw new Error('模型未生成章节结构，请重试。');
              if (record.chapters.some((c) => !validCitations(c.markdown, source.captions).length))
                throw new Error('部分章节缺少有效原文依据，请重新生成。');
              if (
                citationIds(record.markdown).length !==
                validCitations(record.markdown, source.captions).length
              )
                throw new Error('模型引用了不存在的原文片段，请重新生成。');
              record.citationCount = validCitations(record.markdown, source.captions).length;
              if (lengthBudget && !withinLength(readableLength(record.markdown), lengthBudget))
                throw new Error('最终字数未满足篇幅要求，已保留正文，请重试。');
              record.status = 'complete';
              await this.ctx.storage.put('article', record);
              emit('done', {
                chapters: record.chapters,
                expiresAt: record.expiresAt,
                citationCount: record.citationCount,
                markdown: record.markdown,
              });
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
              clearInterval(heartbeat);
              this.aborter = undefined;
              try {
                controller.close();
              } catch {}
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
}
