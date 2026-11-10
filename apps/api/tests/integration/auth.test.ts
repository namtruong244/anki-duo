import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../src/app.js';
import { schema } from '../../src/db/client.js';
import { createAuth } from '../../src/auth.js';
import { createTestDb, type TestDb } from '../helpers/db.js';
import { captureMailer } from '../helpers/mailer.js';
import { ORIGIN_HEADERS, testDeps } from '../helpers/app.js';

const ORIGIN = 'http://localhost:5173';
const json = { 'content-type': 'application/json', origin: ORIGIN, ...ORIGIN_HEADERS };
const email = 'learner@example.test';
const password = 'correct-horse-battery';

let t: TestDb;
let app: ReturnType<typeof createApp>;
let mailer: ReturnType<typeof captureMailer>;

beforeEach(async () => {
  t = await createTestDb();
  mailer = captureMailer();
  const deps = testDeps(t.db, { mailer, env: { ...testDeps(t.db).env, BETTER_AUTH_URL: ORIGIN } });
  deps.auth = createAuth(deps);
  app = createApp(deps);
});
afterEach(() => t.close());

const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  app.request(path, {
    method: 'POST',
    headers: { ...json, ...headers },
    body: JSON.stringify(body),
  });

const signUp = (headers: Record<string, string> = {}) =>
  post('/api/auth/sign-up/email', { email, password, name: 'Learner' }, headers);

const cookieOf = (res: Response) =>
  res.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');

/** Follows the emailed verification link; returns the session cookie it sets. */
async function verify(): Promise<string> {
  const url = new URL(mailer.last('verify').url);
  const res = await app.request(url.pathname + url.search, {
    headers: { ...ORIGIN_HEADERS, origin: ORIGIN },
  });
  expect([200, 302]).toContain(res.status);
  return cookieOf(res);
}

const protectedCall = (headers: Record<string, string>) =>
  app.request('/api/v1/me/settings', {
    method: 'PATCH',
    headers: { ...json, ...headers },
    body: JSON.stringify({ soundEnabled: false }),
  });

describe('sign-up and verification (V13)', () => {
  it('sign-up sends a verification email', async () => {
    const res = await signUp();
    expect(res.status).toBe(200);
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.last('verify').to).toBe(email);
    expect(mailer.last('verify').url).toContain('/api/auth/verify-email?token=');
  });

  it('an unverified user cannot sign in and gets 401 on /api/v1/*', async () => {
    await signUp();
    const signIn = await post('/api/auth/sign-in/email', { email, password });
    expect(signIn.status).toBe(403);
    expect(((await signIn.json()) as { code?: string }).code).toBe('EMAIL_NOT_VERIFIED');
    expect((await protectedCall({})).status).toBe(401);
  });

  it('an unverified sign-in attempt re-sends the verification link', async () => {
    await signUp();
    expect(mailer.sent).toHaveLength(1);
    await post('/api/auth/sign-in/email', { email, password });
    await vi.waitFor(() => expect(mailer.sent).toHaveLength(2));
    expect(mailer.last('verify').to).toBe(email);
  });

  it('after verification a cookie session works', async () => {
    await signUp();
    const cookie = await verify();
    expect(cookie).toContain('session_token');
    expect((await protectedCall({ cookie })).status).not.toBe(401);
  });

  it('creates settings and stats on sign-up from Accept-Language and the client time zone (T043)', async () => {
    await signUp({
      'accept-language': 'vi-VN,vi;q=0.9,en;q=0.8',
      'x-time-zone': 'Asia/Ho_Chi_Minh',
    });
    const [u] = await t.db.select().from(schema.user).where(eq(schema.user.email, email));
    const [s] = await t.db
      .select()
      .from(schema.learnerSettings)
      .where(eq(schema.learnerSettings.userId, u!.id));
    expect(s).toMatchObject({
      locale: 'vi',
      timeZone: 'Asia/Ho_Chi_Minh',
      dayStartHour: 4,
      dailyXpGoal: 20,
      sessionSize: 20,
    });
    const [st] = await t.db
      .select()
      .from(schema.learnerStats)
      .where(eq(schema.learnerStats.userId, u!.id));
    expect(st).toMatchObject({ totalXp: 0, currentStreak: 0, cardCount: 0 });
  });

  it('falls back to English and UTC for other languages and invalid zones', async () => {
    await signUp({ 'accept-language': 'fr-FR', 'x-time-zone': 'Not/AZone' });
    const [row] = await t.db.select().from(schema.learnerSettings);
    expect(row).toMatchObject({ locale: 'en', timeZone: 'UTC' });
  });
});

describe('bearer tokens (V14)', () => {
  async function bearerToken(): Promise<string> {
    await signUp();
    await verify();
    const res = await post('/api/auth/sign-in/email', { email, password });
    expect(res.status).toBe(200);
    const token = res.headers.get('set-auth-token');
    expect(token).toBeTruthy();
    return token!;
  }

  it('Authorization: Bearer works without a cookie', async () => {
    const token = await bearerToken();
    expect((await protectedCall({ authorization: `Bearer ${token}` })).status).not.toBe(401);
  });

  it('a revoked token gets 401', async () => {
    const token = await bearerToken();
    const auth = { authorization: `Bearer ${token}` };
    expect((await post('/api/auth/sign-out', {}, auth)).status).toBe(200);
    expect((await protectedCall(auth)).status).toBe(401);
  });

  it('a garbage token gets 401', async () => {
    expect((await protectedCall({ authorization: 'Bearer nope' })).status).toBe(401);
  });
});

describe('password reset', () => {
  it('emails a link and the new password works', async () => {
    await signUp();
    await verify();
    const res = await post('/api/auth/request-password-reset', {
      email,
      redirectTo: `${ORIGIN}/reset`,
    });
    expect(res.status).toBe(200);
    const link = new URL(mailer.last('reset').url);
    const token = link.pathname.split('/').pop()!;
    const reset = await post('/api/auth/reset-password', {
      newPassword: 'a-brand-new-password',
      token,
    });
    expect(reset.status).toBe(200);
    expect((await post('/api/auth/sign-in/email', { email, password })).status).toBe(401);
    expect(
      (await post('/api/auth/sign-in/email', { email, password: 'a-brand-new-password' })).status,
    ).toBe(200);
  });
});
