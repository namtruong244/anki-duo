import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppEnv } from '../../src/app.js';
import { rateLimit } from '../../src/rate-limit.js';
import { ApiProblem, problemResponse } from '../../src/problem.js';
import { createTestDb, type TestDb } from '../helpers/db.js';

let t: TestDb;
let nowMs: number;

function build(userOf: (req: Request) => string) {
  const app = new Hono<AppEnv>();
  app.onError((e) =>
    e instanceof ApiProblem ? problemResponse(e) : new Response('err', { status: 500 }),
  );
  app.use('*', async (c, next) => {
    c.set('userId', userOf(c.req.raw));
    await next();
  });
  app.use('/api/v1/sync/*', rateLimit({ db: t.db, now: () => new Date(nowMs) }));
  app.use('/api/v1/decks/*/import', rateLimit({ db: t.db, now: () => new Date(nowMs) }));
  app.all('*', (c) => c.json({ ok: true }));
  return app;
}
const as = (user: string) => ({ headers: { 'x-user': user } });
const user = (r: Request) => r.headers.get('x-user') ?? 'anon';

beforeEach(async () => {
  t = await createTestDb();
  nowMs = Date.parse('2026-03-01T12:00:10.000Z');
  // rate_limit_bucket is keyed by user id text, no FK
});
afterEach(() => t.close());

describe('rate limit', () => {
  it('lets 60 requests through and answers the 61st with 429 rate_limited + Retry-After', async () => {
    const app = build(user);
    for (let i = 0; i < 60; i++)
      expect((await app.request('/api/v1/sync/pull', as('u1'))).status).toBe(200);
    const res = await app.request('/api/v1/sync/push', { method: 'POST', ...as('u1') });
    expect(res.status).toBe(429);
    expect(res.headers.get('content-type')).toContain('application/problem+json');
    expect(await res.json()).toMatchObject({ code: 'rate_limited', status: 429 });
    // window started at :00, now is :10, so 50 s remain
    expect(res.headers.get('retry-after')).toBe('50');
  });

  it('also limits deck import, sharing the same per-user budget', async () => {
    const app = build(user);
    for (let i = 0; i < 59; i++) await app.request('/api/v1/sync/pull', as('u1'));
    expect(
      (await app.request('/api/v1/decks/abc/import', { method: 'POST', ...as('u1') })).status,
    ).toBe(200);
    expect(
      (await app.request('/api/v1/decks/abc/import', { method: 'POST', ...as('u1') })).status,
    ).toBe(429);
  });

  it('counts per user', async () => {
    const app = build(user);
    for (let i = 0; i < 60; i++) await app.request('/api/v1/sync/pull', as('u1'));
    expect((await app.request('/api/v1/sync/pull', as('u1'))).status).toBe(429);
    expect((await app.request('/api/v1/sync/pull', as('u2'))).status).toBe(200);
  });

  it('starts a fresh budget in the next minute', async () => {
    const app = build(user);
    for (let i = 0; i < 61; i++) await app.request('/api/v1/sync/pull', as('u1'));
    nowMs += 60_000;
    expect((await app.request('/api/v1/sync/pull', as('u1'))).status).toBe(200);
  });

  it('does not limit other routes', async () => {
    const app = build(user);
    for (let i = 0; i < 80; i++)
      expect((await app.request('/api/v1/decks', as('u1'))).status).toBe(200);
  });
});
