import { createServer } from 'node:http';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readdir, readFile, writeFile, rename, rm, stat } from 'node:fs/promises';
import { createHmac, timingSafeEqual, randomUUID } from 'node:crypto';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const types = {
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
  ogg: 'audio/ogg',
  aac: 'audio/aac',
};
const pattern = /^\/v1\/audio\/([a-f0-9]{32}\.(mp3|wav|m4a|ogg|aac))$/;
export function signature(secret, object, expires) {
  return createHmac('sha256', secret).update(`${object}\n${expires}`).digest('hex');
}
const equal = (a, b) => {
  const x = Buffer.from(a),
    y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};
export async function createGateway({
  root,
  secret,
  publicUrl,
  maxFileBytes = 24 * 1024 * 1024,
  maxTotalBytes = 512 * 1024 * 1024,
  now = Date.now,
}) {
  if (!secret || secret.length < 32)
    throw new Error('MEDIA_GATEWAY_SECRET must contain at least 32 characters');
  const origin = new URL(publicUrl);
  if (
    origin.protocol !== 'https:' ||
    origin.pathname !== '/' ||
    origin.username ||
    origin.password ||
    origin.search ||
    origin.hash
  )
    throw new Error('MEDIA_GATEWAY_PUBLIC_URL must be an HTTPS origin');
  await mkdir(root, { recursive: true, mode: 0o700 });
  let uploading = false;
  let publication = Promise.resolve();
  const serialize = (operation) => {
    const next = publication.then(operation);
    publication = next.catch(() => {});
    return next;
  };
  const path = (object) => join(root, object);
  const info = async (object) => {
    try {
      return JSON.parse(await readFile(path(object + '.json'), 'utf8'));
    } catch (e) {
      if (e.code === 'ENOENT') return null;
      throw e;
    }
  };
  const metadata = async (object, value) => {
    const temporary = path(object + '.json.tmp-' + randomUUID());
    await writeFile(temporary, JSON.stringify(value), { mode: 0o600 });
    await rename(temporary, path(object + '.json'));
  };
  const cleanup = async () => {
    for (const name of await readdir(root)) {
      if (/^[a-f0-9]{32}\.(mp3|wav|m4a|ogg|aac)\.json$/.test(name)) {
        const object = name.slice(0, -5),
          data = await info(object);
        if (data?.expiresAt <= now()) {
          await rm(path(object), { force: true });
          await rm(path(name), { force: true });
        }
      } else if (name.startsWith('.upload-') || name.includes('.json.tmp-')) {
        const file = await stat(path(name)).catch(() => null);
        if (file && file.mtimeMs < now() - 3600000) await rm(path(name), { force: true });
      }
    }
  };
  const used = async () => {
    let bytes = 0;
    for (const name of await readdir(root)) {
      const file = await stat(path(name)).catch(() => null);
      if (file?.isFile()) bytes += file.size;
    }
    return bytes;
  };
  const server = createServer(async (req, res) => {
    const fail = (status, message) => {
      res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ error: message }));
    };
    try {
      const url = new URL(req.url, 'http://internal');
      if (req.method === 'GET' && url.pathname === '/healthz') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{"ok":true}');
        return;
      }
      const match = pattern.exec(url.pathname);
      if (!match) {
        fail(404, 'Not found');
        return;
      }
      const [, _object, format] = match,
        object = _object;
      if (['PUT', 'DELETE'].includes(req.method)) {
        if (!equal(req.headers.authorization ?? '', `Bearer ${secret}`)) {
          fail(401, 'Unauthorized');
          return;
        }
        if (req.method === 'DELETE') {
          // A tombstone prevents a slow, concurrent upload from republishing a deleted file.
          await serialize(async () => {
            await metadata(object, { deleted: true, expiresAt: now() + 3600000 });
            await rm(path(object), { force: true });
          });
          res.writeHead(204);
          res.end();
          return;
        }
        const size = Number(req.headers['content-length']),
          expiresAt = Number(req.headers['x-audio-expires']);
        if (!Number.isSafeInteger(size) || size < 256 || size > maxFileBytes) {
          fail(413, 'Audio size out of bounds');
          return;
        }
        if (
          !Number.isSafeInteger(expiresAt) ||
          expiresAt <= now() ||
          expiresAt > now() + 3600000 + 5000
        ) {
          fail(400, 'Invalid audio expiry');
          return;
        }
        if (uploading) {
          fail(429, 'Another upload is in progress; retry shortly');
          return;
        }
        uploading = true;
        const temporary = path('.upload-' + randomUUID());
        try {
          if ((await info(object))?.deleted) {
            fail(409, 'Audio was deleted');
            return;
          }
          await cleanup();
          if ((await used()) + size > maxTotalBytes) {
            fail(507, 'Temporary audio capacity reached');
            return;
          }
          let received = 0;
          const limit = new Transform({
            transform(chunk, encoding, callback) {
              received += chunk.length;
              callback(received > size ? new Error('Upload exceeded declared size') : null, chunk);
            },
          });
          await pipeline(req, limit, createWriteStream(temporary, { flags: 'wx', mode: 0o600 }));
          if (received !== size) {
            fail(400, 'Incomplete upload');
            return;
          }
          const committed = await serialize(async () => {
            if ((await info(object))?.deleted) return false;
            await rename(temporary, path(object));
            await metadata(object, { size, expiresAt, format });
            return true;
          });
          if (!committed) {
            fail(409, 'Audio was deleted');
            return;
          }
          const expires = Math.floor(expiresAt / 1000);
          const download = new URL(`/v1/audio/${object}`, origin);
          download.searchParams.set('expires', String(expires));
          download.searchParams.set('signature', signature(secret, object, expires));
          res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
          res.end(JSON.stringify({ url: download.href, expiresAt }));
        } finally {
          uploading = false;
          await rm(temporary, { force: true });
        }
        return;
      }
      if (!['GET', 'HEAD'].includes(req.method)) {
        fail(405, 'Method not allowed');
        return;
      }
      const expires = Number(url.searchParams.get('expires')),
        sig = url.searchParams.get('signature') ?? '';
      if (
        !Number.isSafeInteger(expires) ||
        expires * 1000 <= now() ||
        !equal(sig, signature(secret, object, expires))
      ) {
        fail(404, 'Audio not found or expired');
        return;
      }
      const data = await info(object);
      if (!data || data.deleted || data.expiresAt <= now() || expires * 1000 > data.expiresAt) {
        fail(404, 'Audio not found or expired');
        return;
      }
      let start = 0,
        end = data.size - 1;
      if (req.headers.range) {
        const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
        if (!range || (!range[1] && !range[2])) {
          res.writeHead(416, { 'Content-Range': `bytes */${data.size}` });
          res.end();
          return;
        }
        start = range[1] ? Number(range[1]) : Math.max(0, data.size - Number(range[2]));
        end = range[1] && range[2] ? Math.min(Number(range[2]), data.size - 1) : data.size - 1;
        if (
          !Number.isSafeInteger(start) ||
          !Number.isSafeInteger(end) ||
          start < 0 ||
          start > end ||
          start >= data.size
        ) {
          res.writeHead(416, { 'Content-Range': `bytes */${data.size}` });
          res.end();
          return;
        }
      }
      const headers = {
        'Content-Type': types[format],
        'Content-Length': String(end - start + 1),
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
        'X-Robots-Tag': 'noindex, nofollow',
      };
      if (req.headers.range) headers['Content-Range'] = `bytes ${start}-${end}/${data.size}`;
      // Open before sending headers so a concurrently expired file returns a clean 404.
      const stream = createReadStream(path(object), { start, end });
      await new Promise((resolve, reject) => {
        stream.once('open', resolve);
        stream.once('error', reject);
      });
      res.writeHead(req.headers.range ? 206 : 200, headers);
      if (req.method === 'HEAD') {
        stream.destroy();
        res.end();
        return;
      }
      await pipeline(stream, res);
    } catch (e) {
      if (res.headersSent) res.destroy();
      else fail(e.code === 'ENOENT' ? 404 : 500, 'Audio request failed');
    }
  });
  server.requestTimeout = 60000;
  server.headersTimeout = 15000;
  return { server, cleanup, used };
}
async function main() {
  const app = await createGateway({
    root: process.env.MEDIA_GATEWAY_DIR ?? '/var/lib/recast-media',
    secret: process.env.MEDIA_GATEWAY_SECRET,
    publicUrl: process.env.MEDIA_GATEWAY_PUBLIC_URL,
  });
  await app.cleanup();
  const timer = setInterval(
    () => app.cleanup().catch(() => console.error('Temporary audio cleanup failed')),
    60000,
  );
  app.server.listen(Number(process.env.PORT ?? 8789), '127.0.0.1', () =>
    console.log('Recast temporary media gateway ready'),
  );
  for (const signal of ['SIGINT', 'SIGTERM'])
    process.on(signal, () => {
      clearInterval(timer);
      app.server.close();
    });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  });
