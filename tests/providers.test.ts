import { afterEach, expect, it, vi } from 'vitest';
import { generate, modelKey } from '../src/server/ai';
afterEach(() => vi.unstubAllGlobals());
const keys = {
  GEMINI_API_KEY: 'gemini-secret',
  ZHIPU_API_KEY: 'zhipu-secret',
  DEEPSEEK_API_KEY: 'deepseek-secret',
};
it.each([
  ['gemini', 'gemini-secret'],
  ['zhipu', 'zhipu-secret'],
  ['deepseek', 'deepseek-secret'],
])('selects only the configured %s credential', (provider, key) =>
  expect(modelKey({ ...keys, AI_PROVIDER: provider, AI_MODEL: '' })).toBe(key),
);
it('rejects an unknown provider instead of silently sending another provider key', () =>
  expect(() => modelKey({ ...keys, AI_PROVIDER: 'typo', AI_MODEL: '' })).toThrow('配置无效'));
const stream = (content: string) =>
  new Response(
    `data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: 'hidden', content }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`,
  );
it.each([false, true])('routes DeepSeek chat/JSON to its own endpoint (json=%s)', async (json) => {
  const request = vi.fn().mockResolvedValue(stream(json ? '{}' : '中文增量'));
  vi.stubGlobal('fetch', request);
  let result = '';
  for await (const chunk of generate(
    { ...keys, AI_PROVIDER: 'deepseek', AI_MODEL: '' },
    'system json',
    'prompt',
    new AbortController().signal,
    json,
  ))
    result += chunk;
  expect(result).toBe(json ? '{}' : '中文增量');
  expect(request.mock.calls[0][0]).toBe('https://api.deepseek.com/chat/completions');
  const init = request.mock.calls[0][1];
  expect(init.headers.Authorization).toBe('Bearer deepseek-secret');
  const body = JSON.parse(init.body);
  expect(body.model).toBe('deepseek-flash');
  expect(body.stream).toBe(true);
  expect(body.thinking).toEqual({ type: 'disabled' });
  expect(body.response_format).toEqual(json ? { type: 'json_object' } : undefined);
});
it('does not fall back to a saved Zhipu key when DeepSeek has no key', async () => {
  const request = vi.fn();
  vi.stubGlobal('fetch', request);
  await expect(
    (async () => {
      for await (const _ of generate(
        { AI_PROVIDER: 'deepseek', AI_MODEL: '', ZHIPU_API_KEY: 'saved' },
        '',
        '',
        new AbortController().signal,
      ))
        void _;
    })(),
  ).rejects.toThrow('未配置');
  expect(request).not.toHaveBeenCalled();
});
