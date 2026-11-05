import type { OpenAPIHono } from '@hono/zod-openapi';
import { deleteAccountRoute, patchSettingsRoute } from '@anki-duo/contract';
import type { AppEnv } from '../app.js';
import { deleteAccount } from '../services/account.js';
import { updateSettings } from '../services/settings.js';
import { v1 } from './v1.js';

export function registerMe(app: OpenAPIHono<AppEnv>) {
  app.openapi(v1(patchSettingsRoute), async (c) => {
    const { db, now } = c.get('deps');
    return c.json(await updateSettings(db, c.get('userId')!, c.req.valid('json'), now()), 200);
  });

  app.openapi(v1(deleteAccountRoute), async (c) => {
    await deleteAccount(c.get('deps'), c.get('userId')!, c.get('sessionCreatedAt')!);
    return c.body(null, 204);
  });
}
