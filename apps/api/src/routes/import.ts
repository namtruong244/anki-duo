import type { OpenAPIHono } from '@hono/zod-openapi';
import { importRoute } from '@anki-duo/contract';
import type { AppEnv } from '../app.js';
import { importChunk } from '../services/import.js';
import { v1 } from './v1.js';

export function registerImport(app: OpenAPIHono<AppEnv>) {
  app.openapi(v1(importRoute), async (c) => {
    const { db, now } = c.get('deps');
    const { deckId } = c.req.valid('param');
    return c.json(await importChunk(db, c.get('userId')!, deckId, c.req.valid('json'), now()), 200);
  });
}
