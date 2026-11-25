import { DurableObject } from 'cloudflare:workers';
import type { Env } from './env';
import type { Source } from '../shared';
import { youtubeSource } from './youtube';
import { supadataSource } from './supadata';
import { json, message } from './http';
const ttl = 24 * 60 * 60 * 1000;
type Cached = { source: string; expires: number };

// One object per provider + video: shares a single in-flight request across article sessions.
export class TranscriptCache extends DurableObject<Env> {
  private pending?: Promise<Source>;
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.storage.sql.exec(
      'CREATE TABLE IF NOT EXISTS transcript (id INTEGER PRIMARY KEY, source TEXT NOT NULL, expires INTEGER NOT NULL)',
    );
  }
  async fetch(request: Request) {
    const id = new URL(request.url).searchParams.get('id') ?? '';
    if (!/^[\w-]{11}$/.test(id)) return json({ error: '视频编号无效。' }, 400);
    try {
      this.pending ??= this.resolve(id).finally(() => {
        this.pending = undefined;
      });
      return json(await this.pending);
    } catch (error) {
      // Never persist failures, empty responses, or publisher snapshots as a successful lookup.
      return json({ error: message(error) }, 502);
    }
  }
  private async resolve(id: string): Promise<Source> {
    const row = this.ctx.storage.sql
      .exec<Cached>('SELECT source, expires FROM transcript WHERE id = 1')
      .toArray()[0];
    if (row && row.expires > Date.now()) return { ...JSON.parse(row.source), retrieval: 'cache' };
    const signal = AbortSignal.timeout(35_000);
    const source = this.env.SUPADATA_API_KEY
      ? await supadataSource(id, this.env.SUPADATA_API_KEY, signal)
      : await youtubeSource(id, signal);
    source.retrieval = 'live';
    source.fetchedAt = Date.now();
    const expires = source.fetchedAt + ttl;
    this.ctx.storage.sql.exec(
      'INSERT OR REPLACE INTO transcript (id, source, expires) VALUES (1, ?, ?)',
      JSON.stringify(source),
      expires,
    );
    await this.ctx.storage.setAlarm(expires);
    return source;
  }
  async alarm() {
    this.ctx.storage.sql.exec('DELETE FROM transcript WHERE expires <= ?', Date.now());
  }
}
