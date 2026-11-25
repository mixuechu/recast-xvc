import { it, expect } from 'vitest';
import { audioRelay } from '../scripts/dev-asr.mjs';
it('exposes only exact token-protected audio GET/HEAD paths', async () => {
  const server = audioRelay('http://127.0.0.1:1');
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No relay address');
  const base = `http://127.0.0.1:${address.port}`;
  try {
    for (const path of [
      '/',
      '/api/config',
      '/api/generate',
      '/api/audio/not-a-token',
      '/cdn-cgi/local/explorer/api',
    ])
      expect((await fetch(base + path)).status).toBe(404);
    expect(
      (await fetch(`${base}/api/audio/${'a'.repeat(64)}/${'b'.repeat(32)}`, { method: 'POST' }))
        .status,
    ).toBe(404);
  } finally {
    server.closeAllConnections();
    server.close();
  }
});
