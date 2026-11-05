import type { OpenAPIHono } from '@hono/zod-openapi';
import type { AppEnv } from '../app.js';

export function registerMedia(app: OpenAPIHono<AppEnv>) {
  void app; // T106
}
