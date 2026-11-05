import type { OpenAPIHono } from '@hono/zod-openapi';
import { pullRoute } from '@anki-duo/contract';
import type { AppEnv } from '../app.js';
import { pullChanges } from '../sync/pull.js';
import { v1 } from './v1.js';

export function registerSync(app: OpenAPIHono<AppEnv>) {
  app.openapi(v1(pullRoute), async (c) => {
    const { db, now } = c.get('deps');
    const q = c.req.valid('query');
    const body = await pullChanges(db, c.get('userId')!, {
      cursor: Number(q.cursor),
      limit: q.limit ?? 1000,
      deviceId: q.deviceId,
      now: now(),
    });
    return c.json(body, 200);
  });
}
