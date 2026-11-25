import type { Caption, Recognition, Review, ReviewDecision, Source } from '../../shared';
import { parseCaptions, normalizeCaptions } from '../../domain/captions';
import { compareCaptions, applyDecisions, reviewedCaptions } from '../../domain/comparison';
import {
  publicAudioUrl,
  submitRecognition,
  queryRecognition,
  type RecognitionEnv,
} from '../recognition';
import type { StoredArticle } from './types';
export class Reviews {
  constructor(
    private storage: DurableObjectStorage,
    private env: RecognitionEnv,
  ) {}
  get() {
    return this.storage.get<Review>('review');
  }
  recognition() {
    return this.storage.get<Recognition>('recognition');
  }
  async import(article: StoredArticle, text: string, provider: Review['provider'] = 'import') {
    const candidate = parseCaptions(text);
    return this.fromCaptions(article, candidate, provider);
  }
  async fromCaptions(article: StoredArticle, captions: Caption[], provider: Review['provider']) {
    const rows = compareCaptions(article.source.captions, captions);
    return this.storage.transaction(async (tx) => {
      const previous = await tx.get<Review>('review');
      const review: Review = {
        version: (previous?.version ?? 0) + 1,
        provider,
        createdAt: Date.now(),
        rows,
      };
      await tx.put('review', review);
      return review;
    });
  }
  async resolve(
    version: number,
    changes: { id: string; decision: ReviewDecision; text?: string }[],
  ) {
    if (!Array.isArray(changes) || changes.length > 6000) throw new Error('校对提交无效。');
    return this.storage.transaction(async (tx) => {
      const review = await tx.get<Review>('review');
      if (!review || review.version !== version)
        throw new Error('校对版本已更新，请刷新面板后重试。');
      review.rows = applyDecisions(review.rows, changes);
      review.version++;
      await tx.put('review', review);
      return review;
    });
  }
  async exportSource(article: StoredArticle, version: number): Promise<Source> {
    const review = await this.get();
    if (!review || review.version !== version) throw new Error('校对版本已更新，请重新确认。');
    return {
      ...article.source,
      provider: 'reviewed',
      notice: `已按校对版本 ${review.version} 确认；辅助来源：${review.provider === 'volcengine' ? '火山 ASR' : '导入字幕'}。`,
      captions: normalizeCaptions(reviewedCaptions(review.rows)),
    };
  }
  async recognize(article: StoredArticle, url: unknown, format?: string) {
    if (!article.source.captions.some((c) => c.duration > 0))
      throw new Error('辅助校对需要原始字幕有时间轴，请导入 SRT / VTT。');
    if (!this.env.VOLC_ASR_API_KEY)
      throw new Error('尚未配置火山 ASR；可以导入第二份字幕完成校对。');
    const audioUrl = publicAudioUrl(url, format);
    const previous = await this.recognition();
    if (previous && ['queued', 'running'].includes(previous.status))
      throw new Error('已有识别任务正在进行，请等待或停止等待。');
    const task: Recognition = {
      taskId: crypto.randomUUID(),
      status: 'queued',
      createdAt: Date.now(),
      nextPollAt: Date.now() + 5000,
      attempts: 0,
    };
    await this.storage.put('recognition', task);
    try {
      await submitRecognition(this.env, task.taskId, audioUrl, format);
      task.status = 'running';
    } catch (e) {
      task.status = 'failed';
      task.error = e instanceof Error ? e.message : '识别提交失败。';
    }
    const latest = await this.recognition();
    if (latest?.taskId === task.taskId && latest.status !== 'cancelled')
      await this.storage.put('recognition', task);
    return task;
  }
  async cancel() {
    return this.storage.transaction(async (tx) => {
      const task = await tx.get<Recognition>('recognition');
      if (task && ['queued', 'running'].includes(task.status)) {
        task.status = 'cancelled';
        await tx.put('recognition', task);
      }
      return task;
    });
  }
  async resume() {
    return this.storage.transaction(async (tx) => {
      const task = await tx.get<Recognition>('recognition');
      if (
        !task ||
        !['failed', 'cancelled'].includes(task.status) ||
        Date.now() - task.createdAt > 3 * 3600000
      )
        throw new Error('没有可恢复的识别任务，请重新提交。');
      task.status = 'running';
      task.error = undefined;
      task.nextPollAt = Date.now() + 1000;
      await tx.put('recognition', task);
      return task;
    });
  }
  async poll(article: StoredArticle) {
    const task = await this.recognition();
    if (!task || !['queued', 'running'].includes(task.status) || task.nextPollAt > Date.now())
      return task;
    let pendingStatus: 'queued' | 'running' = 'running';
    let captions: Caption[] | null = null,
      error: string | undefined;
    try {
      if (Date.now() - task.createdAt > 3 * 3600000)
        throw new Error('识别等待超时，请稍后重新提交。');
      captions = await queryRecognition(this.env, task.taskId, (status) => {
        pendingStatus = status;
      });
    } catch (e) {
      error = e instanceof Error ? e.message : '识别失败。';
    }
    return this.storage.transaction(async (tx) => {
      const latest = await tx.get<Recognition>('recognition'),
        current = await tx.get<StoredArticle>('article');
      if (
        !current ||
        current.expiresAt <= Date.now() ||
        latest?.taskId !== task.taskId ||
        !['queued', 'running'].includes(latest.status)
      )
        return latest;
      latest.attempts++;
      if (error) {
        latest.status = 'failed';
        latest.error = error;
      } else if (captions) {
        try {
          const previous = await tx.get<Review>('review');
          const review: Review = {
            version: (previous?.version ?? 0) + 1,
            provider: 'volcengine',
            createdAt: Date.now(),
            rows: compareCaptions(article.source.captions, captions),
          };
          await tx.put('review', review);
          latest.status = 'complete';
        } catch (e) {
          latest.status = 'failed';
          latest.error = e instanceof Error ? e.message : '字幕对齐失败。';
        }
      } else {
        latest.status = pendingStatus;
        latest.nextPollAt = Date.now() + 15000;
      }
      await tx.put('recognition', latest);
      return latest;
    });
  }
}
