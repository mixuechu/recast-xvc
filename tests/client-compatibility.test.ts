import { expect, it, vi } from 'vitest';
import app from '../src/server/index';
import type { Env } from '../src/server/env';
vi.mock('cloudflare:workers', () => ({ DurableObject: class {} }));
const id = 'a'.repeat(64);
function harness() {
  const session = vi
    .fn()
    .mockImplementation(async () => Response.json({ captions: [{ id: 'c0001', text: '原文' }] }));
  const assets = vi.fn().mockImplementation(
    async () =>
      new Response('<script type="module" crossorigin src="/assets/index-current.js"></script>', {
        headers: { 'Content-Type': 'text/html' },
      }),
  );
  const env = {
    APP_ACCESS_TOKEN: 'code',
    ASSETS: { fetch: assets },
    SESSIONS: { idFromName: () => id, get: () => ({ fetch: session }) },
  } as unknown as Env;
  return { env, session, assets };
}
it.each(['review', 'recognition', 'audio'])(
  'explains the removed %s endpoint without invoking its old service',
  async (action) => {
    const h = harness();
    const r = await app.fetch(
      new Request(`https://test/api/sessions/${id}/${action}`, {
        headers: { 'X-Access-Code': 'code' },
      }),
      h.env,
    );
    expect(r.status).toBe(410);
    expect(((await r.json()) as { error: string }).error).toContain('请刷新页面');
    expect(h.session).not.toHaveBeenCalled();
    expect(
      (await app.fetch(new Request(`https://test/api/sessions/${id}/${action}`), h.env)).status,
    ).toBe(401);
  },
);
it('keeps the source endpoint working independently of retired panels', async () => {
  const h = harness();
  const r = await app.fetch(
    new Request(`https://test/api/sessions/${id}/source`, { headers: { 'X-Access-Code': 'code' } }),
    h.env,
  );
  expect(r.status).toBe(200);
  expect(((await r.json()) as { captions: unknown[] }).captions).toHaveLength(1);
  expect(new URL(h.session.mock.calls[0][0].url).pathname).toBe('/source');
});
it('reports the currently deployed entry asset without caching it', async () => {
  const h = harness();
  const r = await app.fetch(new Request('https://test/api/version'), h.env);
  expect(await r.json()).toEqual({ asset: '/assets/index-current.js' });
  expect(r.headers.get('Cache-Control')).toBe('no-store');
  expect(new URL(h.assets.mock.calls[0][0].url).pathname).toBe('/index.html');
});
it('does not cache application HTML across deployments', async () => {
  const h = harness();
  const r = await app.fetch(new Request('https://test/'), h.env);
  expect(r.headers.get('Cache-Control')).toBe('no-store');
});
