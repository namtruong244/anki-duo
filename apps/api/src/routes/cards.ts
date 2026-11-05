import type { OpenAPIHono } from '@hono/zod-openapi';
import {
  createCardRoute,
  deleteCardRoute,
  patchCardRoute,
  resetCardRoute,
} from '@anki-duo/contract';
import type { AppEnv } from '../app.js';
import { createCard, deleteCard, resetCardProgress, updateCard } from '../services/cards.js';
import { v1 } from './v1.js';

export function registerCards(app: OpenAPIHono<AppEnv>) {
  app.openapi(v1(createCardRoute), async (c) => {
    const { db, now } = c.get('deps');
    const { deckId } = c.req.valid('param');
    return c.json(await createCard(db, c.get('userId')!, deckId, c.req.valid('json'), now()), 201);
  });
  app.openapi(v1(patchCardRoute), async (c) => {
    const { db, now } = c.get('deps');
    const { cardId } = c.req.valid('param');
    return c.json(await updateCard(db, c.get('userId')!, cardId, c.req.valid('json'), now()), 200);
  });
  app.openapi(v1(deleteCardRoute), async (c) => {
    await deleteCard(c.get('deps'), c.get('userId')!, c.req.valid('param').cardId);
    return c.body(null, 204);
  });
  app.openapi(v1(resetCardRoute), async (c) => {
    const { db, now } = c.get('deps');
    return c.json(
      await resetCardProgress(db, c.get('userId')!, c.req.valid('param').cardId, now()),
      200,
    );
  });
}
