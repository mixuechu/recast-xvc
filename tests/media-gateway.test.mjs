import { it, expect } from 'vitest';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createGateway } from '../services/media-gateway/server.mjs';
async function setup(options = {}) {
  const root = await mkdtemp(join(tmpdir(), 'recast-media-'));
  let current = Date.now();
  const app = await createGateway({
    root,
    secret: 'test-secret-'.repeat(4),
    publicUrl: 'https://media.example.com',
    now: () => current,
    ...options,
  });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const bytes = Buffer.alloc(1024, 7);
  bytes.write('ID3');
  const object = 'a'.repeat(32) + '.mp3';
  const auth = { Authorization: 'Bearer ' + 'test-secret-'.repeat(4) };
  const put = () =>
    fetch(`${base}/v1/audio/${object}`, {
      method: 'PUT',
      headers: { ...auth, 'X-Audio-Expires': String(current + 300000) },
      body: bytes,
    });
  const local = (url) => base + new URL(url).pathname + new URL(url).search;
  return {
    app,
    root,
    base,
    bytes,
    object,
    auth,
    put,
    local,
    advance: () => (current += 3600001),
    close: async () => {
      app.server.closeAllConnections();
      await new Promise((resolve) => app.server.close(resolve));
      await rm(root, { recursive: true, force: true });
    },
  };
}
it('requires upload authentication and returns a signed, expiring URL with HEAD and Range support', async () => {
  const t = await setup();
  try {
    expect(
      (await fetch(`${t.base}/v1/audio/${t.object}`, { method: 'PUT', body: t.bytes })).status,
    ).toBe(401);
    const r = await t.put();
    expect(r.status).toBe(200);
    const { url } = await r.json();
    const file = await fetch(t.local(url));
    expect(Buffer.from(await file.arrayBuffer())).toEqual(t.bytes);
    const range = await fetch(t.local(url), { headers: { Range: 'bytes=100-199' } });
    expect(range.status).toBe(206);
    expect(Buffer.from(await range.arrayBuffer())).toEqual(t.bytes.subarray(100, 200));
    const head = await fetch(t.local(url), { method: 'HEAD' });
    expect(head.headers.get('content-length')).toBe('1024');
    expect(await head.text()).toBe('');
    expect((await fetch(t.local(url).replace('signature=', 'signature=bad'))).status).toBe(404);
    t.advance();
    expect((await fetch(t.local(url))).status).toBe(404);
    await t.app.cleanup();
    expect(await readdir(t.root)).toEqual([]);
  } finally {
    await t.close();
  }
});
it('deletes audio immediately and prevents a deleted object from being uploaded again', async () => {
  const t = await setup();
  try {
    const { url } = await (await t.put()).json();
    expect(
      (await fetch(`${t.base}/v1/audio/${t.object}`, { method: 'DELETE', headers: t.auth })).status,
    ).toBe(204);
    expect((await fetch(t.local(url))).status).toBe(404);
    expect((await t.put()).status).toBe(409);
  } finally {
    await t.close();
  }
});
it('rejects oversized files and enforces a bounded total disk quota', async () => {
  const t = await setup({ maxTotalBytes: 1024 });
  try {
    expect(
      (
        await fetch(`${t.base}/v1/audio/${t.object}`, {
          method: 'PUT',
          headers: {
            ...t.auth,
            'X-Audio-Expires': String(Date.now() + 300000),
            'Content-Length': String(25 * 1024 * 1024),
          },
          body: Buffer.alloc(25 * 1024 * 1024),
        })
      ).status,
    ).toBe(413);
    expect((await t.put()).status).toBe(200);
    expect((await t.put()).status).toBe(507);
  } finally {
    await t.close();
  }
});
