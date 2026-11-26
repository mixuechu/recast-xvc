import { expect, it, vi } from 'vitest';
import app from '../src/server/index';
import type { Env } from '../src/server/env';
vi.mock('cloudflare:workers', () => ({ DurableObject: class {} }));
const id = 'b'.repeat(64);
function harness(quotaStatus = 200) {
  const sessionFetch = vi.fn().mockResolvedValue(
    new Response('event: heartbeat\ndata: {}\n\n', {
      headers: { 'Content-Type': 'text/event-stream' },
    }),
  );
  const quotaFetch = vi.fn().mockResolvedValue(new Response('{}', { status: quotaStatus }));
  const env = {
    AI_PROVIDER: 'deepseek',
    AI_MODEL: 'deepseek-flash',
    DEEPSEEK_API_KEY: 'fake',
    APP_ACCESS_TOKEN: 'review-code',
    SESSIONS: {
      idFromName: vi.fn().mockReturnValue('session'),
      get: vi.fn().mockReturnValue({ fetch: sessionFetch }),
    },
    QUOTAS: {
      idFromName: vi.fn().mockReturnValue('quota'),
      get: vi.fn().mockReturnValue({ fetch: quotaFetch }),
    },
  } as unknown as Env;
  return { env, sessionFetch, quotaFetch };
}
it('forwards only a stored session ID and applies the same request quota to recovery', async () => {
  const h = harness();
  const r = await app.fetch(
    new Request(`https://recast.test/api/sessions/${id}/resume`, {
      method: 'POST',
      headers: { 'X-Access-Code': 'review-code', Origin: 'https://recast.test' },
      body: JSON.stringify({ markdown: 'forged', requirements: 'forged' }),
    }),
    h.env,
  );
  expect(r.status).toBe(200);
  expect(h.quotaFetch).toHaveBeenCalledTimes(1);
  expect(h.sessionFetch).toHaveBeenCalledTimes(1);
  const forwarded = h.sessionFetch.mock.calls[0][0] as Request;
  expect(new URL(forwarded.url).pathname).toBe('/resume');
  expect(await forwarded.text()).toBe('');
});
it.each([
  ['missing code', {}, 'POST', 401],
  [
    'cross origin',
    { 'X-Access-Code': 'review-code', Origin: 'https://attacker.invalid' },
    'POST',
    403,
  ],
  ['wrong method', { 'X-Access-Code': 'review-code' }, 'GET', 405],
] as const)(
  'blocks %s before quota consumption or session access',
  async (_reason, headers, method, status) => {
    const h = harness();
    const r = await app.fetch(
      new Request(`https://recast.test/api/sessions/${id}/resume`, { headers, method }),
      h.env,
    );
    expect(r.status).toBe(status);
    expect(h.sessionFetch).not.toHaveBeenCalled();
    expect(h.quotaFetch).not.toHaveBeenCalled();
  },
);
it('does not enter a session when recovery quota is exhausted', async () => {
  const h = harness(429);
  const r = await app.fetch(
    new Request(`https://recast.test/api/sessions/${id}/resume`, {
      method: 'POST',
      headers: { 'X-Access-Code': 'review-code' },
    }),
    h.env,
  );
  expect(r.status).toBe(429);
  expect(h.sessionFetch).not.toHaveBeenCalled();
});
