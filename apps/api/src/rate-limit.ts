import { sql } from 'drizzle-orm';
import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from './app.js';
import type { Db } from './db/client.js';
import { ApiProblem } from './problem.js';

export const LIMIT_PER_MINUTE = 60;
const WINDOW_MS = 60_000;

/**
 * Fixed one-minute window per user, counted in Postgres so every Lambda container shares it.
 * Mount it after `requireUser`, on `/sync/*` and `/decks/*\/import`.
 */
export function rateLimit(opts?: { db: Db; now: () => Date }): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const { db, now } = opts ?? c.get('deps');
    const userId = c.get('userId');
    if (!userId) throw new ApiProblem(401, 'reauth_required');
    const t = now().getTime();
    const windowStart = new Date(Math.floor(t / WINDOW_MS) * WINDOW_MS);
    const key = `user:${userId}`;

    const result = await db.execute(sql`
      insert into rate_limit_bucket (key, window_start, count)
      values (${key}, ${windowStart.toISOString()}, 1)
      on conflict (key, window_start) do update set count = rate_limit_bucket.count + 1
      returning count`);
    const count = Number(
      (result as unknown as { rows: { count: number | string }[] }).rows[0]!.count,
    );

    if (count === 1) {
      // First hit of a window: drop old buckets so the table stays tiny.
      await db.execute(
        sql`delete from rate_limit_bucket where window_start < ${new Date(t - 3_600_000).toISOString()}`,
      );
    }
    if (count > LIMIT_PER_MINUTE) {
      const retryAfter = Math.max(1, Math.ceil((windowStart.getTime() + WINDOW_MS - t) / 1000));
      throw new ApiProblem(429, 'rate_limited', undefined, undefined, {
        'retry-after': String(retryAfter),
      });
    }
    await next();
  };
}
