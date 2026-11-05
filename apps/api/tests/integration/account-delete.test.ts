import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { schema } from '../../src/db/client.js';
import {
  createCard,
  createDeck,
  createTestDb,
  initialStateArray,
  type TestDb,
} from '../helpers/db.js';
import { appAs } from '../helpers/session.js';
import { fakeStorage } from '../helpers/storage.js';

let t: TestDb;
let fs: ReturnType<typeof fakeStorage>;
let h: ReturnType<typeof appAs>;
let userId: string;
beforeEach(async () => {
  t = await createTestDb();
  fs = fakeStorage();
  h = appAs(t.db, { storage: fs.storage });
  userId = (await h.newUser()).id;
});
afterEach(() => t.close());

const del = (age?: number, user: string | null = userId) =>
  h.call(user, '/me', {
    method: 'DELETE',
    ...(age !== undefined ? { headers: { 'x-test-session-age': String(age) } } : {}),
  });

async function populate(uid: string) {
  const deck = await createDeck(t.db, uid);
  const card = await createCard(t.db, uid, deck.id);
  await t.db.insert(schema.reviewLog).values({
    id: randomUUID(),
    userId: uid,
    cardId: card.id,
    deckId: deck.id,
    kind: 'review',
    grade: 3,
    reviewedAt: new Date(),
    stateBefore: initialStateArray(),
    stateAfter: initialStateArray(),
    schedulerVersion: 'v',
  });
  await t.db.insert(schema.studySession).values({
    id: randomUUID(),
    userId: uid,
    deckId: deck.id,
    kind: 'review',
    startedAt: new Date(),
    studyDay: '2026-03-01',
  });
  await t.db.insert(schema.dailyActivity).values({ userId: uid, studyDay: '2026-03-01' });
  await t.db.insert(schema.device).values({ id: randomUUID(), userId: uid });
  await t.db.insert(schema.mediaAsset).values({
    id: randomUUID(),
    userId: uid,
    cardId: card.id,
    side: 'front',
    kind: 'image',
    mime: 'image/png',
    bytes: 5,
    storageKey: `u/${uid}/m1`,
    status: 'ready',
  });
  await t.db.insert(schema.mediaAsset).values({
    id: randomUUID(),
    userId: uid,
    cardId: card.id,
    side: 'back',
    kind: 'audio',
    mime: 'audio/mpeg',
    bytes: 5,
    storageKey: `u/${uid}/m2`,
    status: 'pending',
  });
  fs.upload(`u/${uid}/m1`, new Uint8Array(5), 'image/png');
  fs.upload(`u/${uid}/m2`, new Uint8Array(5), 'audio/mpeg');
}

describe('DELETE /api/v1/me (V13, FR-030)', () => {
  it('requires a signed-in user', async () =>
    expect((await del(undefined, null)).status).toBe(401));

  it('403 reauth_required when the session is older than 10 minutes', async () => {
    await populate(userId);
    const res = await del(11);
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: 'reauth_required' });
    expect(await t.db.select().from(schema.user).where(eq(schema.user.id, userId))).toHaveLength(1);
  });

  it('a session of exactly 10 minutes is still fresh', async () => {
    expect((await del(10)).status).toBe(204);
  });

  it('removes every row of the user and every media object', async () => {
    await populate(userId);
    expect((await del(1)).status).toBe(204);
    for (const table of [
      schema.user,
      schema.learnerSettings,
      schema.learnerStats,
      schema.deck,
      schema.card,
      schema.mediaAsset,
      schema.reviewLog,
      schema.studySession,
      schema.dailyActivity,
      schema.device,
    ]) {
      expect(await t.db.select().from(table), 'every table is empty').toEqual([]);
    }
    expect([...fs.objects.keys()]).toEqual([]);
  });

  it('leaves other learners untouched', async () => {
    const other = (await h.newUser()).id;
    await populate(userId);
    await populate(other);
    await del(1);
    expect(await t.db.select().from(schema.deck).where(eq(schema.deck.userId, other))).toHaveLength(
      1,
    );
    expect(await t.db.select().from(schema.card).where(eq(schema.card.userId, other))).toHaveLength(
      1,
    );
    expect([...fs.objects.keys()].sort()).toEqual([`u/${other}/m1`, `u/${other}/m2`]);
  });

  it('works without configured storage', async () => {
    const bare = appAs(t.db);
    expect((await bare.call(userId, '/me', { method: 'DELETE' })).status).toBe(204);
  });
});
