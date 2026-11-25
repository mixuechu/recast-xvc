// Local preview stays local. The tunnel exposes only expiring, token-protected audio GETs.
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { Readable } from 'node:stream';
import { pathToFileURL } from 'node:url';
export function audioRelay(base) {
  return createServer(async (request, response) => {
    if (
      !['GET', 'HEAD'].includes(request.method) ||
      !/^\/api\/audio\/[a-f0-9]{64}\/[a-f0-9]{32}$/.test(request.url ?? '')
    ) {
      response.writeHead(404).end();
      return;
    }
    try {
      const upstream = await fetch(new URL(request.url, base), {
        method: request.method,
        headers: request.headers.range ? { Range: request.headers.range } : {},
        signal: AbortSignal.timeout(60000),
      });
      response.writeHead(upstream.status, Object.fromEntries(upstream.headers));
      if (upstream.body) Readable.fromWeb(upstream.body).pipe(response);
      else response.end();
    } catch {
      if (!response.headersSent) response.writeHead(502);
      response.end();
    }
  });
}
async function main() {
  const port = Number(process.env.PORT ?? 8787);
  const relay = audioRelay(`http://127.0.0.1:${port}`);
  await new Promise((resolve, reject) => {
    relay.once('error', reject);
    relay.listen(0, '127.0.0.1', resolve);
  });
  const address = relay.address();
  const tunnel = spawn(
    'cloudflared',
    ['tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${address.port}`],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  );
  let worker;
  let stopping = false;
  const stop = (code = 0) => {
    if (stopping) return;
    stopping = true;
    clearTimeout(timeout);
    worker?.kill('SIGTERM');
    tunnel.kill('SIGTERM');
    relay.closeAllConnections();
    relay.close();
    process.exitCode = code;
  };
  process.on('SIGINT', () => stop());
  process.on('SIGTERM', () => stop());
  tunnel.on('error', () => {
    console.error('找不到 cloudflared，请安装官方客户端后重试。');
    stop(1);
  });
  tunnel.on('exit', (code) => {
    if (!stopping) {
      console.error('临时音频回调已断开，请重新启动。');
      stop(code || 1);
    }
  });
  let output = '';
  const timeout = setTimeout(() => {
    console.error('临时音频回调建立超时，请检查网络。');
    stop(1);
  }, 45000);
  tunnel.stderr.on('data', (data) => {
    output = (output + data.toString()).slice(-12000);
    const origin = output.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/)?.[0];
    if (!origin || worker || stopping) return;
    clearTimeout(timeout);
    console.log('已建立仅供音频下载的临时回调；网页和管理API保持本地访问。');
    worker = spawn(
      process.execPath,
      [
        'node_modules/wrangler/bin/wrangler.js',
        'dev',
        '--port',
        String(port),
        '--persist-to',
        process.env.RECAST_STATE_DIR ?? '.wrangler/state',
        '--var',
        `PUBLIC_BASE_URL:${origin}`,
      ],
      { stdio: 'inherit' },
    );
    worker.on('error', () => stop(1));
    worker.on('exit', (code) => stop(code ?? 1));
  });
  tunnel.on('exit', () => clearTimeout(timeout));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  });
