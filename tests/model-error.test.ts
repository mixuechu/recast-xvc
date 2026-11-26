import { expect, it } from 'vitest';
import { modelError } from '../src/server/model-error';
const limited = (count: number, retry?: string) =>
  new Response(
    JSON.stringify({
      error: {
        message: `Rate limit exceeded (limit: ${count} requests per day on Free Tier). Private project details.`,
      },
    }),
    { status: 429, headers: retry ? { 'Retry-After': retry } : {} },
  );
it('distinguishes daily quota exhaustion and reports the provided wait', async () => {
  const error = await modelError(limited(20, '15685'), 'gemini');
  expect(error.message).toBe(
    'Gemini每日免费调用额度已用尽（20次/天）。预计约4小时22分钟后可重试。',
  );
  expect(error.message).not.toContain('Private');
});
it('does not suggest waiting will unlock a zero free quota', async () => {
  const error = await modelError(limited(0, '15685'), 'gemini');
  expect(error.message).toContain('免费调用额度为0');
  expect(error.message).not.toContain('后可重试');
});
it('does not invent a reset time when it is absent', async () => {
  expect((await modelError(limited(20), 'gemini')).message).not.toContain('预计');
});
it('keeps generic Gemini rate limits separate from a proven daily quota', async () => {
  expect((await modelError(new Response('{}', { status: 429 }), 'gemini')).message).toBe(
    'Gemini请求频率或额度受限，请稍后重试。',
  );
});
it('recognizes Google API_KEY_INVALID without exposing upstream details', async () => {
  const response = new Response(
    JSON.stringify({
      error: { message: 'private details', details: [{ reason: 'API_KEY_INVALID' }] },
    }),
    { status: 400 },
  );
  expect((await modelError(response, 'gemini')).message).toContain('授权失败');
});
it('preserves other providers errors without exposing response bodies', async () => {
  expect((await modelError(new Response('private', { status: 429 }), 'deepseek')).message).toBe(
    '模型当前请求较多或额度不足，请稍后重试。',
  );
});
