import { it, expect, vi } from 'vitest';
import { Reviews } from '../src/server/session/reviews';
import { queryRecognition } from '../src/server/recognition';
import type { StoredArticle } from '../src/server/session/types';
import type { Recognition, Caption } from '../src/shared';
vi.mock('../src/server/recognition', () => ({
  queryRecognition: vi.fn(),
  submitRecognition: vi.fn(),
  publicAudioUrl: (url: string) => url,
}));
function memory() {
  const data = new Map<string, unknown>();
  const api = {
    get: async (key: string) => structuredClone(data.get(key)),
    put: async (key: string, value: unknown) => {
      data.set(key, structuredClone(value));
    },
    transaction: async (fn: (tx: unknown) => unknown) => fn(api),
  };
  return { data, storage: api as unknown as DurableObjectStorage };
}
const article = {
  expiresAt: Date.now() + 86400000,
  source: { captions: [{ id: 'c0001', text: 'Original.', offset: 0, duration: 2 }] },
} as StoredArticle;
function task(id = 'first'): Recognition {
  return { taskId: id, status: 'running', createdAt: Date.now(), nextPollAt: 0, attempts: 0 };
}
it('does not publish recognition results after the user stops waiting', async () => {
  const { data, storage } = memory();
  data.set('article', article);
  data.set('recognition', task());
  let finish!: (caps: Caption[]) => void;
  vi.mocked(queryRecognition).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const reviews = new Reviews(storage, {}),
    pending = reviews.poll(article);
  await vi.waitFor(() => expect(queryRecognition).toHaveBeenCalled());
  await reviews.cancel();
  finish([{ id: 'c0001', text: 'Candidate.', offset: 0, duration: 2 }]);
  await pending;
  expect((data.get('recognition') as Recognition).status).toBe('cancelled');
  expect(data.has('review')).toBe(false);
});
it('does not let an earlier result overwrite a replacement job', async () => {
  const { data, storage } = memory();
  data.set('article', article);
  data.set('recognition', task());
  let finish!: (caps: Caption[]) => void;
  vi.mocked(queryRecognition)
    .mockClear()
    .mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
  const pending = new Reviews(storage, {}).poll(article);
  await vi.waitFor(() => expect(queryRecognition).toHaveBeenCalled());
  data.set('recognition', task('replacement'));
  finish([{ text: 'Old candidate.', offset: 0, duration: 2 }]);
  await pending;
  expect((data.get('recognition') as Recognition).taskId).toBe('replacement');
  expect(data.has('review')).toBe(false);
});
