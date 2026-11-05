import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { schema } from '../../src/db/client.js';
import {
  createCard,
  createDeck,
  createTestDb,
  createUser,
  initialStateArray,
  type TestDb,
} from '../helpers/db.js';
import { appAs } from '../helpers/session.js';
import { fakeStorage } from '../helpers/storage.js';

let t: TestDb;
let h: ReturnType<typeof appAs>;
let userId: string;
beforeEach(async () => {
  t = await createTestDb();
  h = appAs(t.db);
  userId = (await h.newUser()).id;
});
afterEach(() => t.close());

const create = (json: unknown, user: string | null = userId) =>
  h.call(user, '/decks', { method: 'POST', json });
const patch = (id: string, json: unknown, user: string | null = userId) =>
  h.call(user, `/decks/${id}`, { method: 'PATCH', json });
const del = (id: string, user: string | null = userId) =>
  h.call(user, `/decks/${id}`, { method: 'DELETE' });

describe('POST /decks', () => {
  it('requires a signed-in user', async () =>
    expect((await create({ name: 'x' }, null)).status).toBe(401));

  it('creates a deck with defaults', async () => {
    const res = await create({ name: '  Từ vựng  ' });
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({
      name: 'Từ vựng',
      newCardsPerDay: 20,
      deletedAt: null,
    });
  });

  it('honours a client id and is idempotent for it', async () => {
    const id = randomUUID();
    expect((await create({ id, name: 'A' })).status).toBe(201);
    const again = await create({ id, name: 'A' });
    expect(again.status).toBe(201);
    expect((await t.db.select().from(schema.deck)).length).toBe(1);
  });

  it.each([[''], ['   '], ['x'.repeat(101)]])('rejects the name %j', async (name) => {
    expect((await create({ name })).status).toBe(422);
  });

  it('accepts names of 1 and 100 chars', async () => {
    expect((await create({ name: 'a' })).status).toBe(201);
    expect((await create({ name: 'b'.repeat(100) })).status).toBe(201);
  });

  it('newCardsPerDay must be 0-999', async () => {
    expect((await create({ name: 'z0', newCardsPerDay: 0 })).status).toBe(201);
    expect((await create({ name: 'z999', newCardsPerDay: 999 })).status).toBe(201);
    expect((await create({ name: 'zbad', newCardsPerDay: 1000 })).status).toBe(422);
    expect((await create({ name: 'zneg', newCardsPerDay: -1 })).status).toBe(422);
  });

  it('a duplicate name (case-insensitive, trimmed) gives 409 deck_name_taken', async () => {
    await create({ name: 'Spanish' });
    const res = await create({ name: ' sPANISH ' });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: 'deck_name_taken' });
  });

  it('two learners may use the same name', async () => {
    const other = await createUser(t.db);
    await create({ name: 'Shared' });
    expect((await create({ name: 'Shared' }, other.id)).status).toBe(201);
  });
});

describe('PATCH /decks/{id}', () => {
  it('renames and changes the new-card limit', async () => {
    const d = await createDeck(t.db, userId, { name: 'Old' });
    const res = await patch(d.id, { name: 'New', newCardsPerDay: 5 });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id: d.id, name: 'New', newCardsPerDay: 5 });
  });

  it("renaming to its own name in another case is allowed; to another deck's name is 409", async () => {
    const a = await createDeck(t.db, userId, { name: 'Alpha' });
    await createDeck(t.db, userId, { name: 'Beta' });
    expect((await patch(a.id, { name: 'ALPHA' })).status).toBe(200);
    const res = await patch(a.id, { name: 'beta' });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: 'deck_name_taken' });
  });

  it('404 for unknown, deleted or foreign decks; 422 for an empty patch', async () => {
    const other = await createUser(t.db);
    const theirs = await createDeck(t.db, other.id);
    expect((await patch(randomUUID(), { name: 'x' })).status).toBe(404);
    expect((await patch(theirs.id, { name: 'x' })).status).toBe(404);
    const mine = await createDeck(t.db, userId);
    expect((await patch(mine.id, {})).status).toBe(422);
  });
});

describe('DELETE /decks/{id}', () => {
  it('deletes the media objects from storage', async () => {
    const fs = fakeStorage();
    const withStorage = appAs(t.db, { storage: fs.storage });
    const d = await createDeck(t.db, userId);
    const c = await createCard(t.db, userId, d.id);
    fs.upload('u/key-1', new Uint8Array([1, 2, 3]), 'image/png');
    await t.db.insert(schema.mediaAsset).values({
      id: randomUUID(),
      userId,
      cardId: c.id,
      side: 'front',
      kind: 'image',
      mime: 'image/png',
      bytes: 3,
      storageKey: 'u/key-1',
      status: 'ready',
    });
    expect((await withStorage.call(userId, `/decks/${d.id}`, { method: 'DELETE' })).status).toBe(
      204,
    );
    expect(fs.objects.has('u/key-1')).toBe(false);
  });

  it('removes cards, review logs and media rows, and leaves a tombstone that pull returns', async () => {
    const d = await createDeck(t.db, userId, { name: 'Doomed' });
    const c = await createCard(t.db, userId, d.id);
    await t.db.insert(schema.reviewLog).values({
      id: randomUUID(),
      userId,
      cardId: c.id,
      deckId: d.id,
      kind: 'review',
      grade: 3,
      reviewedAt: new Date(),
      stateBefore: initialStateArray(),
      stateAfter: initialStateArray(),
      schedulerVersion: 'v',
    });
    await t.db.insert(schema.mediaAsset).values({
      id: randomUUID(),
      userId,
      cardId: c.id,
      side: 'front',
      kind: 'image',
      mime: 'image/png',
      bytes: 10,
      storageKey: 'k',
      status: 'ready',
    });
    const res = await del(d.id);
    expect(res.status).toBe(204);

    expect(await t.db.select().from(schema.card).where(eq(schema.card.deckId, d.id))).toEqual([]);
    expect(
      await t.db.select().from(schema.reviewLog).where(eq(schema.reviewLog.deckId, d.id)),
    ).toEqual([]);
    expect(await t.db.select().from(schema.mediaAsset)).toEqual([]);
    const [tomb] = await t.db.select().from(schema.deck).where(eq(schema.deck.id, d.id));
    expect(tomb).toMatchObject({ name: '' });
    expect(tomb!.deletedAt).not.toBeNull();

    const pulled = (await (
      await h.call(userId, `/sync/pull?cursor=0&deviceId=${randomUUID()}`)
    ).json()) as { decks: { id: string; deletedAt: string | null }[]; cards: unknown[] };
    expect(pulled.decks.find((x) => x.id === d.id)?.deletedAt).toEqual(expect.any(String));
    expect(pulled.cards).toEqual([]);
  });

  it('frees the name and updates the card count', async () => {
    const d = await createDeck(t.db, userId, { name: 'Reuse' });
    await createCard(t.db, userId, d.id);
    await t.db
      .update(schema.learnerStats)
      .set({ cardCount: 1 })
      .where(eq(schema.learnerStats.userId, userId));
    await del(d.id);
    expect((await create({ name: 'Reuse' })).status).toBe(201);
    const [stats] = await t.db
      .select()
      .from(schema.learnerStats)
      .where(eq(schema.learnerStats.userId, userId));
    expect(stats!.cardCount).toBe(0);
  });

  it("404 for unknown, already deleted and foreign decks, and never touches another learner's data", async () => {
    const other = await createUser(t.db);
    const theirs = await createDeck(t.db, other.id);
    await createCard(t.db, other.id, theirs.id);
    expect((await del(theirs.id)).status).toBe(404);
    expect(
      (await t.db.select().from(schema.card).where(eq(schema.card.deckId, theirs.id))).length,
    ).toBe(1);
    const mine = await createDeck(t.db, userId);
    await del(mine.id);
    expect((await del(mine.id)).status).toBe(404);
  });
});
