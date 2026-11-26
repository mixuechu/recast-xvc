import { afterEach, expect, it, vi } from 'vitest';
import { generate } from '../src/server/ai';
import {
  createProvider,
  DeepSeekProvider,
  GeminiProvider,
  ZhipuProvider,
} from '../src/server/providers';
afterEach(() => vi.unstubAllGlobals());
const keys = {
  GEMINI_API_KEY: 'gemini-secret',
  ZHIPU_API_KEY: 'zhipu-secret',
  DEEPSEEK_API_KEY: 'deepseek-secret',
};
it.each([
  ['deepseek', DeepSeekProvider, 'deepseek-flash'],
  ['gemini', GeminiProvider, 'gemini-3.6-flash'],
  ['zhipu', ZhipuProvider, 'glm-4.7'],
] as const)('creates the selected %s provider without exposing keys', (name, Provider, model) => {
  const provider = createProvider({ ...keys, AI_PROVIDER: name, AI_MODEL: '' });
  expect(provider).toBeInstanceOf(Provider);
  expect(provider.name).toBe(name);
  expect(provider.model).toBe(model);
  expect(provider.configured).toBe(true);
  for (const key of Object.values(keys)) expect(JSON.stringify(provider)).not.toContain(key);
});
it.each(['deepseek', 'gemini', 'zhipu'])('reports a missing %s credential', (name) => {
  expect(createProvider({ AI_PROVIDER: name, AI_MODEL: '' }).configured).toBe(false);
});
it('rejects an unknown provider instead of silently sending another provider key', () =>
  expect(() => createProvider({ ...keys, AI_PROVIDER: 'typo', AI_MODEL: '' })).toThrow('配置无效'));
const stream = (content: string) =>
  new Response(
    `data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: 'hidden', content }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`,
  );
it.each([
  ['deepseek', false],
  ['deepseek', true],
  ['zhipu', false],
  ['zhipu', true],
] as const)('routes %s chat/JSON to its own endpoint (json=%s)', async (provider, json) => {
  const request = vi.fn().mockResolvedValue(stream(json ? '{}' : '中文增量'));
  vi.stubGlobal('fetch', request);
  let result = '';
  for await (const chunk of generate(
    { ...keys, AI_PROVIDER: provider, AI_MODEL: '' },
    'system json',
    'prompt',
    new AbortController().signal,
    json,
  ))
    result += chunk;
  expect(result).toBe(json ? '{}' : '中文增量');
  expect(request).toHaveBeenCalledTimes(1);
  expect(request.mock.calls[0][0]).toBe(
    provider === 'deepseek'
      ? 'https://api.deepseek.com/chat/completions'
      : 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
  );
  const init = request.mock.calls[0][1];
  expect(init.headers.Authorization).toBe(
    `Bearer ${provider === 'deepseek' ? keys.DEEPSEEK_API_KEY : keys.ZHIPU_API_KEY}`,
  );
  const body = JSON.parse(init.body);
  expect(body.model).toBe(provider === 'deepseek' ? 'deepseek-flash' : 'glm-4.7');
  expect(body.stream).toBe(true);
  expect(body.thinking).toEqual({ type: 'disabled' });
  expect(body.response_format).toEqual(json ? { type: 'json_object' } : undefined);
});
it.each(['deepseek', 'gemini', 'zhipu'] as const)(
  'does not fall back when %s has no key',
  async (provider) => {
    const request = vi.fn();
    vi.stubGlobal('fetch', request);
    const keyName = {
      deepseek: 'DEEPSEEK_API_KEY',
      gemini: 'GEMINI_API_KEY',
      zhipu: 'ZHIPU_API_KEY',
    }[provider];
    const env = { ...keys, AI_PROVIDER: provider, AI_MODEL: '', [keyName]: undefined };
    expect(createProvider(env).configured).toBe(false);
    await expect(
      (async () => {
        for await (const _ of generate(env, '', '', new AbortController().signal)) void _;
      })(),
    ).rejects.toThrow('未配置');
    expect(request).not.toHaveBeenCalled();
  },
);

it.each([false, true])('routes Gemini chat/JSON with its own key (json=%s)', async (json) => {
  const content = json ? '{}' : '中文增量';
  const request = vi
    .fn()
    .mockResolvedValue(
      new Response(
        `data: ${JSON.stringify({ event_type: 'step.start', index: 0, step: { type: 'model_output' } })}\n\ndata: ${JSON.stringify({ event_type: 'step.delta', index: 0, delta: { type: 'text', text: content } })}\n\ndata: ${JSON.stringify({ event_type: 'interaction.completed', interaction: { status: 'completed' } })}\n\n`,
      ),
    );
  vi.stubGlobal('fetch', request);
  let result = '';
  for await (const chunk of generate(
    { ...keys, AI_PROVIDER: 'gemini', AI_MODEL: '' },
    'system JSON',
    'prompt',
    new AbortController().signal,
    json,
  ))
    result += chunk;
  expect(result).toBe(content);
  expect(request.mock.calls[0][0]).toBe(
    'https://generativelanguage.googleapis.com/v1beta/interactions?alt=sse',
  );
  const init = request.mock.calls[0][1];
  expect(init.headers['x-goog-api-key']).toBe('gemini-secret');
  expect(init.headers.Authorization).toBeUndefined();
  const body = JSON.parse(init.body);
  expect(body.response_format?.mime_type).toBe(json ? 'application/json' : undefined);
  expect(body.model).toBe('gemini-3.6-flash');
  expect(body.store).toBe(false);
  expect(body.stream).toBe(true);
  expect(init.headers['Api-Revision']).toBe('2026-05-20');
});

it('bounds Gemini busy retries before consuming a stream', async () => {
  vi.useFakeTimers();
  try {
    const request = vi.fn().mockImplementation(async () => new Response('busy', { status: 503 }));
    vi.stubGlobal('fetch', request);
    const result = (async () => {
      for await (const _ of generate(
        { ...keys, AI_PROVIDER: 'gemini', AI_MODEL: '' },
        '',
        '',
        new AbortController().signal,
      )) {
        /* consume */
      }
    })();
    const assertion = expect(result).rejects.toThrow('503');
    await vi.runAllTimersAsync();
    await assertion;
    expect(request).toHaveBeenCalledTimes(3);
  } finally {
    vi.useRealTimers();
  }
});
it('cancels Gemini backoff without sending another request', async () => {
  vi.useFakeTimers();
  try {
    const controller = new AbortController();
    const request = vi.fn().mockResolvedValue(new Response('busy', { status: 503 }));
    vi.stubGlobal('fetch', request);
    const result = (async () => {
      for await (const _ of generate(
        { ...keys, AI_PROVIDER: 'gemini', AI_MODEL: '' },
        '',
        '',
        controller.signal,
      )) {
        /* consume */
      }
    })();
    const assertion = expect(result).rejects.toMatchObject({ name: 'AbortError' });
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    await assertion;
    expect(request).toHaveBeenCalledTimes(1);
  } finally {
    vi.useRealTimers();
  }
});

it('honors Retry-After before retrying a busy Gemini response', async () => {
  vi.useFakeTimers();
  try {
    const request = vi
      .fn()
      .mockImplementation(
        async () => new Response('busy', { status: 503, headers: { 'Retry-After': '30' } }),
      );
    vi.stubGlobal('fetch', request);
    const controller = new AbortController();
    const result = (async () => {
      for await (const _ of generate(
        { ...keys, AI_PROVIDER: 'gemini', AI_MODEL: '' },
        '',
        '',
        controller.signal,
      )) {
        /*consume*/
      }
    })();
    const assertion = expect(result).rejects.toMatchObject({ name: 'AbortError' });
    await vi.advanceTimersByTimeAsync(29999);
    expect(request).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(request).toHaveBeenCalledTimes(2);
    controller.abort();
    await assertion;
  } finally {
    vi.useRealTimers();
  }
});
it('does not retry earlier than a server delay longer than its interactive budget', async () => {
  const request = vi
    .fn()
    .mockResolvedValue(new Response('busy', { status: 503, headers: { 'Retry-After': '120' } }));
  vi.stubGlobal('fetch', request);
  const result = (async () => {
    for await (const _ of generate(
      { ...keys, AI_PROVIDER: 'gemini', AI_MODEL: '' },
      '',
      '',
      new AbortController().signal,
    )) {
      /*consume*/
    }
  })();
  await expect(result).rejects.toThrow('503');
  expect(request).toHaveBeenCalledTimes(1);
});
