import { DatabaseSync } from 'node:sqlite';
import { afterEach, expect, it, vi } from 'vitest';
import { TranscriptCache } from '../src/server/TranscriptCache';
import { supadataSource } from '../src/server/supadata';
import { youtubeSource } from '../src/server/youtube';
import type { Env } from '../src/server/env';
import type { Source } from '../src/shared';
vi.mock('cloudflare:workers', () => ({
  DurableObject: class {
    constructor(
      readonly ctx: DurableObjectState,
      readonly env: Env,
    ) {}
  },
}));
vi.mock('../src/server/supadata', () => ({ supadataSource: vi.fn() }));
vi.mock('../src/server/youtube', () => ({ youtubeSource: vi.fn() }));
const databases: DatabaseSync[] = [];
afterEach(() => {
  databases.splice(0).forEach((db) => db.close());
  vi.resetAllMocks();
  vi.useRealTimers();
});
function harness(key?: string) {
  const db = new DatabaseSync(':memory:');
  databases.push(db);
  const ctx = {
    storage: {
      sql: {
        exec(query: string, ...bindings: (string | number)[]) {
          const statement = db.prepare(query);
          if (statement.columns().length) return { toArray: () => statement.all(...bindings) };
          statement.run(...bindings);
          return { toArray: () => [] };
        },
      },
      setAlarm: vi.fn(),
    },
  } as unknown as DurableObjectState;
  const env = { SUPADATA_API_KEY: key } as Env;
  return { db, ctx, env, object: new TranscriptCache(ctx, env) };
}
const request = () => new Request('https://internal/transcript?id=aircAruvnKk');
const source = (): Source => ({
  kind: 'youtube',
  videoId: 'aircAruvnKk',
  title: 'Lecture',
  provider: 'youtube',
  captions: [{ text: 'Caption', offset: 0, duration: 1 }],
});
it('merges concurrent misses, persists across objects, then refreshes after expiry', async () => {
  vi.useFakeTimers();
  const h = harness('key');
  let finish!: (source: Source) => void;
  vi.mocked(supadataSource).mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const first = h.object.fetch(request()),
    second = h.object.fetch(request());
  finish(source());
  expect(((await (await first).json()) as Source).retrieval).toBe('live');
  await second;
  expect(supadataSource).toHaveBeenCalledTimes(1);
  const restarted = new TranscriptCache(h.ctx, h.env);
  expect(((await (await restarted.fetch(request())).json()) as Source).retrieval).toBe('cache');
  expect(supadataSource).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(24 * 3600_000 + 1);
  vi.mocked(supadataSource).mockResolvedValueOnce(source());
  expect(((await (await restarted.fetch(request())).json()) as Source).retrieval).toBe('live');
  expect(supadataSource).toHaveBeenCalledTimes(2);
});
it('does not cache failures and clears the in-flight slot for a subsequent retry', async () => {
  const h = harness('key');
  vi.mocked(supadataSource)
    .mockRejectedValueOnce(new Error('Unavailable'))
    .mockResolvedValueOnce(source());
  expect((await h.object.fetch(request())).status).toBe(502);
  expect((await h.object.fetch(request())).status).toBe(200);
  expect(supadataSource).toHaveBeenCalledTimes(2);
  expect(youtubeSource).not.toHaveBeenCalled();
});
it('retains the direct adapter when no service key is configured', async () => {
  const h = harness();
  vi.mocked(youtubeSource).mockResolvedValueOnce(source());
  expect((await h.object.fetch(request())).status).toBe(200);
  expect(youtubeSource).toHaveBeenCalledTimes(1);
  expect(supadataSource).not.toHaveBeenCalled();
});
it('alarms remove expired rows while retaining a refreshed entry', async () => {
  vi.useFakeTimers();
  const h = harness('key');
  vi.mocked(supadataSource).mockResolvedValue(source());
  await h.object.fetch(request());
  await h.object.alarm();
  expect(h.db.prepare('SELECT COUNT(*) AS n FROM transcript').get()?.n).toBe(1);
  vi.advanceTimersByTime(24 * 3600_000 + 1);
  await h.object.alarm();
  expect(h.db.prepare('SELECT COUNT(*) AS n FROM transcript').get()?.n).toBe(0);
});
