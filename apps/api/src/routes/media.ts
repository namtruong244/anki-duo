import type { OpenAPIHono } from '@hono/zod-openapi';
import {
  completeMediaRoute,
  deleteMediaRoute,
  getMediaRoute,
  uploadUrlRoute,
} from '@anki-duo/contract';
import type { AppEnv } from '../app.js';
import {
  completeUpload,
  deleteMedia,
  requireStorage,
  reserveUpload,
  signedMediaUrl,
} from '../services/media.js';
import { v1 } from './v1.js';

export function registerMedia(app: OpenAPIHono<AppEnv>) {
  app.openapi(v1(uploadUrlRoute), async (c) => {
    const { db, now, storage } = c.get('deps');
    return c.json(
      await reserveUpload(
        db,
        requireStorage(storage),
        c.get('userId')!,
        now(),
        c.req.valid('json'),
      ),
      200,
    );
  });

  app.openapi(v1(completeMediaRoute), async (c) => {
    const { db, storage } = c.get('deps');
    return c.json(
      await completeUpload(
        db,
        requireStorage(storage),
        c.get('userId')!,
        c.req.valid('param').mediaId,
      ),
      200,
    );
  });

  app.openapi(v1(getMediaRoute), async (c) => {
    const { db, storage } = c.get('deps');
    const url = await signedMediaUrl(
      db,
      requireStorage(storage),
      c.get('userId')!,
      c.req.valid('param').mediaId,
    );
    return c.redirect(url, 302) as never;
  });

  app.openapi(v1(deleteMediaRoute), async (c) => {
    const { db, now, storage } = c.get('deps');
    await deleteMedia(
      db,
      requireStorage(storage),
      c.get('userId')!,
      c.req.valid('param').mediaId,
      now(),
    );
    return c.body(null, 204);
  });
}
