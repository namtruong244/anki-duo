import type { OpenAPIHono } from '@hono/zod-openapi';
import { createApp, type AppEnv } from '../../src/app.js';
import { createAuth } from '../../src/auth.js';
import type { Db } from '../../src/db/client.js';
import { createUser } from './db.js';
import { ORIGIN_HEADERS, testDeps } from './app.js';
import type { AppDeps } from '../../src/app.js';

/** A full app whose auth is replaced by a lookup of `Authorization: Bearer <userId>`. */
export function appAs(db: Db, over: Partial<AppDeps> = {}) {
  const deps = testDeps(db, over);
  const real = createAuth(deps);
  // Tests act as a given user without going through sign-in; production auth is covered by auth.test.ts.
  deps.auth = {
    ...real,
    api: {
      ...real.api,
      getSession: async ({ headers }: { headers: Headers }) => {
        const id = headers.get('authorization')?.replace('Bearer ', '');
        return id && id !== 'nope' ? { user: { id, emailVerified: true }, session: {} } : null;
      },
    },
  } as unknown as NonNullable<AppDeps['auth']>;
  const app: OpenAPIHono<AppEnv> = createApp(deps);

  const call = (
    userId: string | null,
    path: string,
    init: RequestInit & { json?: unknown } = {},
  ) => {
    const { json, ...rest } = init;
    const headers: Record<string, string> = {
      ...ORIGIN_HEADERS,
      ...(rest.headers as Record<string, string>),
    };
    if (userId) headers.authorization = `Bearer ${userId}`;
    if (json !== undefined) headers['content-type'] = 'application/json';
    return app.request(`/api/v1${path}`, {
      ...rest,
      headers,
      ...(json !== undefined ? { body: JSON.stringify(json) } : {}),
    });
  };
  return { app, deps, call, newUser: () => createUser(db) };
}
