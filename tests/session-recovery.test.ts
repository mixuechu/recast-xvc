import { afterEach, expect, it, vi } from 'vitest';
import { ArticleSession } from '../src/server/session/ArticleSession';
import { generate } from '../src/server/ai';
import { getSource } from '../src/server/transcript';
import type { Env } from '../src/server/env';
import type { Source } from '../src/shared';
import type { StoredArticle } from '../src/server/session/types';
vi.mock('cloudflare:workers', () => ({
  DurableObject: class {
    constructor(
      readonly ctx: DurableObjectState,
      readonly env: Env,
    ) {}
  },
}));
vi.mock('../src/server/ai', async () => ({
  ...(await vi.importActual('../src/server/ai')),
  generate: vi.fn(),
}));
vi.mock('../src/server/transcript', async () => ({
  ...(await vi.importActual('../src/server/transcript')),
  getSource: vi.fn(),
}));
afterEach(() => vi.resetAllMocks());
const source: Source = {
  kind: 'manual',
  title: '原稿',
  captions: [
    { id: 'c0001', text: '提问者问为什么应先明确任务边界。', offset: 0, duration: 2 },
    {
      id: 'c0002',
      text: '讲者回答先把任务和已有数据说明清楚，再决定如何使用模型。',
      offset: 2,
      duration: 2,
    },
  ],
};
const draft =
  '# 任务边界\n\n## 从问题开始\n\n**提问者：** 为什么应当先明确任务边界，然后再决定工具？\n\n**讲者：** 先把任务和已有的数据说明清楚，再决定如何使用模型。';
const repair = JSON.stringify({
  paragraphs: [
    { id: 'p2', citationIds: ['c0001'] },
    { id: 'p3', citationIds: ['c0002'] },
  ],
});
const id = 'a'.repeat(64);
function harness() {
  const data = new Map<string, unknown>();
  const storage = {
    get: async <T>(key: string) => structuredClone(data.get(key)) as T | undefined,
    put: async (key: string, value: unknown) => {
      data.set(key, structuredClone(value));
    },
    deleteAll: async () => data.clear(),
    setAlarm: vi.fn(),
  };
  const jobs: Promise<unknown>[] = [];
  const ctx = {
    storage,
    waitUntil: (job: Promise<unknown>) => jobs.push(job),
  } as unknown as DurableObjectState;
  const env = { AI_PROVIDER: 'deepseek', AI_MODEL: 'test' } as Env;
  return { data, storage, ctx, env, jobs, object: new ArticleSession(ctx, env) };
}
const start = () =>
  new Request(`https://internal/generate?id=${id}`, {
    method: 'POST',
    body: JSON.stringify({
      mode: 'manual',
      transcript: '原文',
      requirements: '整理为一个章节，保留对话。',
    }),
  });
const resume = () =>
  new Request('https://internal/resume', {
    method: 'POST',
    body: JSON.stringify({ markdown: 'forged', requirements: 'forged' }),
  });
const route = (path: string, method = 'GET') => new Request('https://internal/' + path, { method });
function failOnce() {
  let repairCalls = 0;
  vi.mocked(getSource).mockResolvedValue(source);
  vi.mocked(generate).mockImplementation(async function* (_env, system) {
    if (system.includes('原文引用核对员')) yield repairCalls++ === 0 ? '{}' : repair;
    else yield draft;
  });
}
it('resumes evidence checking from saved context after restart, without fetching captions or regenerating the draft', async () => {
  const h = harness();
  failOnce();
  const first = await (await h.object.fetch(start())).text();
  expect(first).toContain('event: error');
  const saved = await h.storage.get<StoredArticle>('article');
  expect(saved?.processingStage).toBe('evidence');
  expect(saved?.status).toBe('interrupted');
  expect(saved?.failure).toContain('引用核对');
  const restarted = new ArticleSession(h.ctx, h.env);
  const wire = await (await restarted.fetch(resume())).text();
  expect(wire).toContain('event: done');
  expect(wire).not.toContain('forged');
  const article = (await (await restarted.fetch(route('article'))).json()) as StoredArticle;
  expect(article.status).toBe('complete');
  expect(article.processingStage).toBeUndefined();
  expect(article.failure).toBeUndefined();
  expect(article.markdown).toContain('source-c0002');
  expect(getSource).toHaveBeenCalledTimes(1);
  expect(
    vi.mocked(generate).mock.calls.filter((call) => !call[1].includes('原文引用核对员')),
  ).toHaveLength(1);
  expect((await restarted.fetch(resume())).status).toBe(409);
  expect(JSON.stringify(article.source)).not.toContain('captions');
});
it('does not resume an initial draft whose model stream was interrupted', async () => {
  const h = harness();
  vi.mocked(getSource).mockResolvedValue(source);
  vi.mocked(generate).mockImplementation(async function* () {
    yield draft;
    throw new Error('Disconnected');
  });
  await (await h.object.fetch(start())).text();
  expect((await h.storage.get<StoredArticle>('article'))?.processingStage).toBeUndefined();
  expect((await h.object.fetch(resume())).status).toBe(409);
});
it('prevents concurrent recovery requests from creating duplicate model work', async () => {
  const h = harness();
  failOnce();
  await (await h.object.fetch(start())).text();
  let finish!: (value: string) => void;
  vi.mocked(generate).mockImplementation(async function* () {
    yield await new Promise<string>((resolve) => {
      finish = resolve;
    });
  });
  const response = await h.object.fetch(resume());
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
  expect((await h.object.fetch(resume())).status).toBe(409);
  finish(repair);
  expect(await response.text()).toContain('event: done');
});
it('does not resurrect a deleted article when pending recovery work finishes', async () => {
  const h = harness();
  failOnce();
  await (await h.object.fetch(start())).text();
  let finish!: (value: string) => void;
  vi.mocked(generate).mockImplementation(async function* () {
    yield await new Promise<string>((resolve) => {
      finish = resolve;
    });
  });
  const response = await h.object.fetch(resume());
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
  expect((await h.object.fetch(route('article', 'DELETE'))).status).toBe(200);
  finish(repair);
  await response.text();
  expect((await h.object.fetch(route('article'))).status).toBe(404);
  expect(h.data.size).toBe(0);
});
it('keeps a cancelled recovery checkpoint but does not save a cancellation as a model failure', async () => {
  const h = harness();
  failOnce();
  await (await h.object.fetch(start())).text();
  let entered = false;
  vi.mocked(generate).mockImplementation(async function* (_env, _system, _prompt, signal) {
    entered = true;
    await new Promise<void>((_resolve, reject) =>
      signal.addEventListener('abort', () => reject(signal.reason), { once: true }),
    );
    yield '';
  });
  const response = await h.object.fetch(resume());
  await vi.waitFor(() => expect(entered).toBe(true));
  await h.object.fetch(route('cancel', 'POST'));
  await response.text();
  const saved = await h.storage.get<StoredArticle>('article');
  expect(saved?.status).toBe('interrupted');
  expect(saved?.processingStage).toBe('evidence');
  expect(saved?.failure).toBeUndefined();
});
it('rejects recovery after expiry', async () => {
  const h = harness();
  failOnce();
  await (await h.object.fetch(start())).text();
  const saved = await h.storage.get<StoredArticle>('article');
  saved!.expiresAt = Date.now() - 1;
  await h.storage.put('article', saved);
  expect((await h.object.fetch(resume())).status).toBe(404);
});

it('resumes a failed length edit without repeating source retrieval, draft generation or evidence checking', async () => {
  const h = harness();
  vi.mocked(getSource).mockResolvedValue(source);
  let initial = 0,
    editing = 0;
  const longDraft =
    '# 任务边界\n\n## 从问题开始\n\n**提问者：** ' +
    '为什么先明确边界？'.repeat(30) +
    ' [原文](#source-c0001)\n\n**讲者：** ' +
    '先说明任务和已有数据，再选择模型。'.repeat(30) +
    ' [原文](#source-c0002)';
  vi.mocked(generate).mockImplementation(async function* (_env, system) {
    if (system.includes('中文篇幅编辑')) {
      if (editing++ === 0) throw new Error('Temporary model failure');
      yield JSON.stringify({
        edits: [
          { id: 'p2', text: '为什么先明确边界？' },
          { id: 'p3', text: '先说明任务和已有数据，再选择模型。' },
        ],
      });
    } else {
      initial++;
      yield longDraft;
    }
  });
  const request = new Request(`https://internal/generate?id=${id}`, {
    method: 'POST',
    body: JSON.stringify({
      mode: 'manual',
      transcript: '原文',
      requirements: '100字以内，保留对话。',
    }),
  });
  expect(await (await h.object.fetch(request)).text()).toContain('event: error');
  expect((await h.storage.get<StoredArticle>('article'))?.processingStage).toBe('length');
  expect(await (await h.object.fetch(resume())).text()).toContain('event: done');
  expect(getSource).toHaveBeenCalledTimes(1);
  expect(initial).toBe(1);
  expect(editing).toBe(2);
});

it('rechecks length for an older evidence checkpoint and normalizes only existing source IDs', async () => {
  const h = harness();
  await h.storage.put('article', {
    id,
    schemaVersion: 2,
    source,
    requirements: '100字以内，保留对话。',
    markdown:
      '# 任务边界\n\n## 从问题开始\n\n**提问者：** ' +
      '为什么先明确边界？'.repeat(30) +
      ' [原文](#source-0001)\n\n**讲者：** ' +
      '先说明任务和已有数据，再选择模型。'.repeat(30) +
      ' [原文](#source-cc0002)',
    chapters: [],
    summaries: {},
    status: 'generating',
    processingStage: 'evidence',
    createdAt: Date.now(),
    expiresAt: Date.now() + 86400000,
  });
  vi.mocked(generate).mockImplementation(async function* (_env, system) {
    expect(system).toContain('中文篇幅编辑');
    yield JSON.stringify({
      edits: [
        { id: 'p2', text: '为什么先明确边界？' },
        { id: 'p3', text: '先说明任务和已有数据，再选择模型。' },
      ],
    });
  });
  expect(await (await h.object.fetch(resume())).text()).toContain('event: done');
  const saved = await h.storage.get<StoredArticle>('article');
  expect(saved?.markdown).toContain('#source-c0001');
  expect(saved?.markdown).toContain('#source-c0002');
  expect(saved?.processingStage).toBeUndefined();
  expect(getSource).not.toHaveBeenCalled();
  expect(generate).toHaveBeenCalledTimes(1);
});
