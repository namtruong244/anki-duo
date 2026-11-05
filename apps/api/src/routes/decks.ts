import type { OpenAPIHono } from '@hono/zod-openapi';
import { createDeckRoute, deleteDeckRoute, patchDeckRoute } from '@anki-duo/contract';
import type { AppEnv } from '../app.js';
import { createDeck, deleteDeck, updateDeck } from '../services/decks.js';
import { v1 } from './v1.js';

export function registerDecks(app: OpenAPIHono<AppEnv>) {
  app.openapi(v1(createDeckRoute), async (c) => {
    const { db, now } = c.get('deps');
    return c.json(await createDeck(db, c.get('userId')!, c.req.valid('json'), now()), 201);
  });
  app.openapi(v1(patchDeckRoute), async (c) => {
    const { db, now } = c.get('deps');
    const { deckId } = c.req.valid('param');
    return c.json(await updateDeck(db, c.get('userId')!, deckId, c.req.valid('json'), now()), 200);
  });
  app.openapi(v1(deleteDeckRoute), async (c) => {
    await deleteDeck(c.get('deps'), c.get('userId')!, c.req.valid('param').deckId);
    return c.body(null, 204);
  });
}
