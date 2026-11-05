import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../helpers/db.js';
import { appAs } from '../helpers/session.js';

let t: TestDb;
let userId: string;
let lines: string[];
let h: ReturnType<typeof appAs>;
beforeEach(async () => {
  t = await createTestDb();
  lines = [];
  h = appAs(t.db, { log: (l) => lines.push(l) });
  userId = (await h.newUser()).id;
});
afterEach(() => t.close());

const send = (json: unknown, user: string | null = userId) =>
  h.call(user, '/client-events', { method: 'POST', json });

describe('POST /api/v1/client-events', () => {
  it('requires a signed-in user', async () =>
    expect((await send({ kind: 'error', message: 'x' }, null)).status).toBe(401));

  it('accepts an error and logs it with a hashed user id', async () => {
    const res = await send({ kind: 'error', message: 'boom', context: { route: '/session' } });
    expect(res.status).toBe(202);
    const logged = lines.map((l) => JSON.parse(l)).find((l) => l.msg === 'client_event');
    expect(logged).toMatchObject({
      kind: 'error',
      message: 'boom',
      context: { route: '/session' },
    });
    expect(logged.userIdHash).toMatch(/^[0-9a-f]{12}$/);
    expect(JSON.stringify(logged)).not.toContain(userId);
  });

  it('accepts a sync_failure and a 2000-char message', async () => {
    expect((await send({ kind: 'sync_failure', message: 'x'.repeat(2000) })).status).toBe(202);
  });

  it.each([
    [{ kind: 'error', message: 'x'.repeat(2001) }],
    [{ kind: 'nope', message: 'x' }],
    [{ kind: 'error' }],
  ])('rejects %j', async (body) => {
    expect((await send(body)).status).toBe(400);
  });
});
