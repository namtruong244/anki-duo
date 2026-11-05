import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { createAuth } from '../../src/auth.js';
import { createTestDb, type TestDb } from '../helpers/db.js';
import { captureMailer } from '../helpers/mailer.js';
import { ORIGIN_HEADERS, testDeps } from '../helpers/app.js';

const ORIGIN = 'http://localhost:5173';
let t: TestDb;
afterEach(() => t.close());
beforeEach(async () => {
  t = await createTestDb();
});

async function sessionCookies(nodeEnv: string) {
  const mailer = captureMailer();
  const base = testDeps(t.db);
  const deps = {
    ...base,
    mailer,
    env: { ...base.env, BETTER_AUTH_URL: ORIGIN, NODE_ENV: nodeEnv, ORIGIN_SECRET: 'test-origin' },
  };
  const app = createApp({ ...deps, auth: createAuth(deps) });
  const headers = { 'content-type': 'application/json', origin: ORIGIN, ...ORIGIN_HEADERS };
  await app.request('/api/auth/sign-up/email', {
    method: 'POST',
    headers,
    body: JSON.stringify({ email: 'c@example.test', password: 'correct-horse-battery', name: 'C' }),
  });
  const link = new URL(mailer.last('verify').url);
  const res = await app.request(link.pathname + link.search, { headers });
  return res.headers.getSetCookie();
}

describe('session cookie flags (security)', () => {
  it('is httpOnly, SameSite=Lax and Secure in production', async () => {
    const cookies = await sessionCookies('production');
    const session = cookies.find((c) => c.includes('session_token'))!;
    expect(session).toMatch(/HttpOnly/i);
    expect(session).toMatch(/SameSite=Lax/i);
    expect(session).toMatch(/Secure/i);
  });

  it('is httpOnly and SameSite=Lax in development (no TLS locally)', async () => {
    const session = (await sessionCookies('development')).find((c) => c.includes('session_token'))!;
    expect(session).toMatch(/HttpOnly/i);
    expect(session).toMatch(/SameSite=Lax/i);
  });
});
