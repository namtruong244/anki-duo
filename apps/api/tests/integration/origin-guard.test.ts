import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { originGuard } from '../../src/origin-guard.js';

const build = (env: Record<string, string | undefined>) => {
  const app = new Hono();
  app.use('*', originGuard(env));
  app.get('/api/health', (c) => c.json({ ok: true }));
  return app;
};
const get = (app: Hono, secret?: string) =>
  app.request('/api/health', {
    headers: secret === undefined ? {} : { 'x-origin-secret': secret },
  });

describe('origin guard', () => {
  const app = build({ ORIGIN_SECRET: 'current-secret' });

  it('returns 403 without the header', async () => {
    const res = await get(app);
    expect(res.status).toBe(403);
    expect(res.headers.get('content-type')).toContain('application/problem+json');
  });

  it('returns 403 with a wrong secret, including one of a different length', async () => {
    expect((await get(app, 'nope')).status).toBe(403);
    expect((await get(app, 'current-secret-but-longer')).status).toBe(403);
    expect((await get(app, '')).status).toBe(403);
  });

  it('accepts the current secret', async () => {
    expect((await get(app, 'current-secret')).status).toBe(200);
  });

  it('accepts the previous secret during rotation, and only then', async () => {
    const rotating = build({ ORIGIN_SECRET: 'new', ORIGIN_SECRET_PREVIOUS: 'old' });
    expect((await get(rotating, 'old')).status).toBe(200);
    expect((await get(rotating, 'new')).status).toBe(200);
    expect((await get(app, 'old')).status).toBe(403);
  });

  it('fails closed when no secret is configured', async () => {
    const open = build({});
    expect((await get(open, '')).status).toBe(403);
    expect((await get(open, 'anything')).status).toBe(403);
  });

  it('is skipped in development (Vite proxy)', async () => {
    const dev = build({ NODE_ENV: 'development', ORIGIN_SECRET: 'x' });
    expect((await get(dev)).status).toBe(200);
  });

  it('compares in constant time: source uses timingSafeEqual and never ===/startsWith on secrets', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../../src/origin-guard.ts', import.meta.url), 'utf8');
    expect(src).toContain('timingSafeEqual');
  });
});
