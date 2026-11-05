import type { OpenAPIHono } from '@hono/zod-openapi';
import { clientEventRoute } from '@anki-duo/contract';
import type { AppEnv } from '../app.js';
import { hashUserId } from '../log.js';
import { v1 } from './v1.js';

/** Browser errors and sync failures, written to the same structured log as requests. */
export function registerClientEvents(app: OpenAPIHono<AppEnv>) {
  app.openapi(v1(clientEventRoute), async (c) => {
    const { log = console.log } = c.get('deps');
    const body = c.req.valid('json');
    log(
      JSON.stringify({
        level: 'warn',
        msg: 'client_event',
        requestId: c.get('requestId'),
        userIdHash: hashUserId(c.get('userId')!),
        kind: body.kind,
        message: body.message,
        context: body.context,
      }),
    );
    return c.body(null, 202);
  });
}
