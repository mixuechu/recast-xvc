import { DurableObject } from 'cloudflare:workers';
import { json } from './http';
import type { Env } from './env';
export class Quota extends DurableObject<Env> {
  async fetch() {
    const now = Date.now();
    const slot = Math.floor(now / 3600000);
    const current = await this.ctx.storage.get<{ slot: number; count: number }>('quota');
    const count = current?.slot === slot ? current.count + 1 : 1;
    if (count > 12) return json({ error: '本小时生成次数已达上限，请稍后再试。' }, 429);
    await this.ctx.storage.put('quota', { slot, count });
    await this.ctx.storage.setAlarm(now + 3600000);
    return json({ ok: true });
  }
  async alarm() {
    await this.ctx.storage.deleteAll();
  }
}
