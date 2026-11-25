import { it, expect } from 'vitest';
import { Reviews } from '../src/server/session/reviews';
import { normalizeCaptions } from '../src/domain/captions';
import type { StoredArticle } from '../src/server/session/types';
function store() {
  const data = new Map<string, unknown>();
  const api = {
    get: async (key: string) => structuredClone(data.get(key)),
    put: async (key: string, value: unknown) => {
      data.set(key, structuredClone(value));
    },
    transaction: async (fn: (tx: unknown) => unknown) => fn(api),
  };
  return api as unknown as DurableObjectStorage;
}
const article = {
  source: {
    kind: 'manual',
    title: 'Test',
    captions: normalizeCaptions([{ text: 'Revenue 15.', offset: 0, duration: 2 }]),
  },
} as StoredArticle;
it('enforces review versions and exports only fully confirmed revisions', async () => {
  const reviews = new Reviews(store(), {});
  const imported = await reviews.import(article, '00:00.000 --> 00:02.000\nRevenue 50.');
  await expect(reviews.exportSource(article, imported.version)).rejects.toThrow('确认');
  const saved = await reviews.resolve(imported.version, [
    { id: imported.rows[0].id, decision: 'candidate' },
  ]);
  await expect(reviews.resolve(imported.version, [])).rejects.toThrow('版本');
  expect((await reviews.exportSource(article, saved.version)).captions[0].text).toBe('Revenue 50.');
  expect(article.source.captions[0].text).toBe('Revenue 15.');
});
it('leaves the original source unchanged when manual review is replaced', async () => {
  const reviews = new Reviews(store(), {});
  const first = await reviews.import(article, '00:00.000 --> 00:02.000\nRevenue 50.');
  const second = await reviews.import(article, '00:00.000 --> 00:02.000\nRevenue 70.');
  expect(second.version).toBe(first.version + 1);
  expect(article.source.captions[0].text).toContain('15');
});
it('resumes tracking the same failed provider job without submitting a duplicate', async () => {
  const storage = store();
  await storage.put('recognition', {
    taskId: 'same-provider-task',
    status: 'failed',
    createdAt: Date.now(),
    nextPollAt: 0,
    attempts: 3,
    error: 'Temporary error',
  });
  const task = await new Reviews(storage, {}).resume();
  expect(task.taskId).toBe('same-provider-task');
  expect(task.status).toBe('running');
  expect(task.error).toBeUndefined();
});
