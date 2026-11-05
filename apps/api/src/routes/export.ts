import type { OpenAPIHono } from '@hono/zod-openapi';
import { exportDeckRoute, restoreDeckRoute } from '@anki-duo/contract';
import type { AppEnv } from '../app.js';
import { exportDeck, restoreDeck } from '../services/export.js';
import { v1 } from './v1.js';

export function registerExport(app: OpenAPIHono<AppEnv>) {
  app.openapi(v1(exportDeckRoute), async (c) => {
    const { db, storage, now } = c.get('deps');
    const { doc, fileName } = await exportDeck(
      db,
      storage,
      c.get('userId')!,
      c.req.valid('param').deckId,
      now(),
    );
    c.header('content-disposition', `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`);
    return c.json(doc, 200);
  });

  app.openapi(v1(restoreDeckRoute), async (c) => {
    const { db, now } = c.get('deps');
    return c.json(await restoreDeck(db, c.get('userId')!, c.req.valid('json'), now()), 201);
  });
}
