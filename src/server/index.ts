import type { Env } from './env';
import { body, json, message } from './http';
export { ArticleSession } from './session/ArticleSession';
export { Quota } from './Quota';
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    let response: Response;
    try {
      if (!url.pathname.startsWith('/api/')) response = await env.ASSETS.fetch(request);
      else if (request.method === 'GET' && url.pathname === '/api/config')
        response = json({
          provider: env.AI_PROVIDER,
          model: env.AI_MODEL,
          accessRequired: !!env.APP_ACCESS_TOKEN,
          recognitionConfigured: !!env.VOLC_ASR_API_KEY,
          configured: !!(env.AI_PROVIDER === 'gemini' ? env.GEMINI_API_KEY : env.ZHIPU_API_KEY),
        });
      else {
        if (request.headers.get('origin') && request.headers.get('origin') !== url.origin)
          return json({ error: '请从本站发起请求。' }, 403);
        if (env.APP_ACCESS_TOKEN && request.headers.get('X-Access-Code') !== env.APP_ACCESS_TOKEN)
          return json({ error: '请输入正确的访问码。' }, 401);
        if (url.pathname === '/api/generate' && request.method === 'POST') {
          const input = await body(request);
          if (!['youtube', 'sample', 'manual', 'revision'].includes(String(input.mode)))
            return json({ error: '请选择字幕来源。' }, 400);
          if (typeof input.requirements !== 'string' || input.requirements.length > 2000)
            return json({ error: '生成要求最多 2,000 字。' }, 400);
          if (
            (input.mode === 'youtube' && typeof input.url !== 'string') ||
            (input.mode === 'manual' && typeof input.transcript !== 'string')
          )
            return json({ error: '请填写视频链接或字幕。' }, 400);
          const quota = await env.QUOTAS.get(
            env.QUOTAS.idFromName(request.headers.get('CF-Connecting-IP') ?? 'local'),
          ).fetch(new Request('https://internal/consume', { method: 'POST' }));
          if (!quota.ok) return quota;
          const id = Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) =>
            byte.toString(16).padStart(2, '0'),
          ).join('');
          const safeInput: Record<string, unknown> = {
            mode: input.mode,
            url: input.url,
            transcript: input.transcript,
            requirements: input.requirements,
          };
          if (input.mode === 'revision') {
            if (
              typeof input.fromSessionId !== 'string' ||
              !/^([a-f0-9]{64})$/.test(input.fromSessionId) ||
              !Number.isInteger(input.reviewVersion)
            )
              return json({ error: '校对版本无效。' }, 400);
            const exported = await env.SESSIONS.get(
              env.SESSIONS.idFromName(input.fromSessionId),
            ).fetch(
              new Request('https://internal/revision-export', {
                method: 'POST',
                body: JSON.stringify({ version: input.reviewVersion }),
              }),
            );
            if (!exported.ok) return exported;
            safeInput.resolvedSource = await exported.json();
            safeInput.parentId = input.fromSessionId;
            safeInput.reviewVersion = input.reviewVersion;
          }
          response = await env.SESSIONS.get(env.SESSIONS.idFromName(id)).fetch(
            new Request(`https://internal/generate?id=${id}`, {
              method: 'POST',
              body: JSON.stringify(safeInput),
            }),
          );
        } else {
          const match =
            /^\/api\/sessions\/([a-f0-9]{64})(?:\/(summary|cancel|source|review|recognition))?$/.exec(
              url.pathname,
            );
          if (!match) return json({ error: '接口不存在。' }, 404);
          const [, id, action] = match;
          if (
            (action &&
              !(
                action === 'source'
                  ? ['GET']
                  : action === 'review'
                    ? ['GET', 'POST']
                    : action === 'recognition'
                      ? ['GET', 'POST', 'DELETE']
                      : ['POST']
              ).includes(request.method)) ||
            (!action && !['GET', 'DELETE'].includes(request.method))
          )
            return json({ error: '请求方法不支持。' }, 405);
          const payload =
            action && !['cancel', 'source'].includes(action) && request.method === 'POST'
              ? await body(request)
              : undefined;
          response = await env.SESSIONS.get(env.SESSIONS.idFromName(id)).fetch(
            new Request(`https://internal/${action ?? 'article'}`, {
              method: request.method,
              ...(payload ? { body: JSON.stringify(payload) } : {}),
            }),
          );
        }
      }
    } catch (e) {
      response = json({ error: message(e) }, 400);
    }
    const headers = new Headers(response.headers);
    headers.set('X-Content-Type-Options', 'nosniff');
    headers.set('Referrer-Policy', 'no-referrer');
    headers.set(
      'Content-Security-Policy',
      "default-src 'self'; media-src https: blob:; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
    );
    return new Response(response.body, { status: response.status, headers });
  },
} satisfies ExportedHandler<Env>;
