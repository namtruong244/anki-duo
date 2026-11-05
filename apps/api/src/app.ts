import { randomUUID } from 'node:crypto';
import { OpenAPIHono } from '@hono/zod-openapi';
import type { Auth } from './auth.js';
import type { Db } from './db/client.js';
import type { Env } from './env.js';
import { hashUserId, logRequest, outcomeOf } from './log.js';
import type { Mailer } from './mailer.js';
import { requireUser } from './middleware/require-user.js';
import { originGuard } from './origin-guard.js';
import { rateLimit } from './rate-limit.js';
import { registerMe } from './routes/me.js';
import { ApiProblem, problemResponse, validationHook } from './problem.js';

export interface AppDeps {
  db: Db;
  env: Env;
  /** Injected clock; the API never reads the real time directly (Principle II). */
  now: () => Date;
  log?: (line: string) => void;
  mailer?: Mailer;
  auth?: Auth;
}

export interface AppVariables {
  deps: AppDeps;
  requestId: string;
  userId?: string;
}
export type AppEnv = { Variables: AppVariables };

export function createApp(deps: AppDeps) {
  const app = new OpenAPIHono<AppEnv>({ defaultHook: validationHook });

  app.use('*', async (c, next) => {
    const requestId = c.req.header('x-request-id') ?? randomUUID();
    c.set('requestId', requestId);
    c.set('deps', deps);
    const started = performance.now();
    await next();
    c.header('x-request-id', requestId);
    const userId = c.get('userId');
    logRequest(
      {
        requestId,
        userIdHash: userId ? hashUserId(userId) : undefined,
        method: c.req.method,
        route: c.req.routePath,
        status: c.res.status,
        durationMs: Math.round(performance.now() - started),
        outcome: outcomeOf(c.res.status),
      },
      deps.log,
    );
  });

  app.use('*', originGuard(deps.env));

  app.onError((err, c) => {
    if (err instanceof ApiProblem) return problemResponse(err);
    console.error(
      JSON.stringify({
        level: 'error',
        msg: 'unhandled',
        requestId: c.get('requestId'),
        error: String(err),
      }),
    );
    return new Response(
      JSON.stringify({
        type: 'about:blank',
        title: 'Internal error',
        status: 500,
        code: 'validation_failed',
      }),
      { status: 500, headers: { 'content-type': 'application/problem+json' } },
    );
  });
  app.notFound((c) =>
    problemResponse(new ApiProblem(404, 'not_found', `No route for ${c.req.path}`)),
  );

  app.get('/api/health', (c) => c.json({ ok: true }));

  // Better Auth owns /api/auth/*; everything under /api/v1 needs a verified user.
  app.on(['GET', 'POST'], '/api/auth/*', (c) => {
    const auth = c.get('deps').auth;
    if (!auth) throw new ApiProblem(404, 'not_found');
    return auth.handler(c.req.raw);
  });
  app.use('/api/v1/*', requireUser);
  app.use('/api/v1/sync/*', rateLimit());
  app.use('/api/v1/decks/*/import', rateLimit());

  registerMe(app);

  return app;
}
