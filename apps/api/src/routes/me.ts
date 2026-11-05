import type { OpenAPIHono } from '@hono/zod-openapi';
import { patchSettingsRoute } from '@anki-duo/contract';
import type { AppEnv } from '../app.js';
import { updateSettings } from '../services/settings.js';
import { v1 } from './v1.js';

export function registerMe(app: OpenAPIHono<AppEnv>) {
  app.openapi(v1(patchSettingsRoute), async (c) => {
    const { db, now } = c.get('deps');
    return c.json(await updateSettings(db, c.get('userId')!, c.req.valid('json'), now()), 200);
  });
}
