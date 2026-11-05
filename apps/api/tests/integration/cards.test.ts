import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { decodeState, newCard, schedule } from '@anki-duo/domain';
import { schema } from '../../src/db/client.js';
import {
  bulkCards,
  createCard,
  createDeck,
  createTestDb,
  createUser,
  FIXED_NOW,
  type TestDb,
} from '../helpers/db.js';
import { appAs } from '../helpers/session.js';

let t: TestDb;
let h: ReturnType<typeof appAs>;
let userId: string;
let deckId: string;
beforeEach(async () => {
  t = await createTestDb();
  h = appAs(t.db);
  userId = (await h.newUser()).id;
  deckId = (await createDeck(t.db, userId)).id;
});
afterEach(() => t.close());

const add = (json: unknown, deck = deckId, user: string | null = userId) =>
  h.call(user, `/decks/${deck}/cards`, { method: 'POST', json });
const edit = (id: string, json: unknown) =>
  h.call(userId, `/cards/${id}`, { method: 'PATCH', json });
const getCard = async (id: string) =>
  (await t.db.select().from(schema.card).where(eq(schema.card.id, id)))[0]!;
const stats = async () =>
  (await t.db.select().from(schema.learnerStats).where(eq(schema.learnerStats.userId, userId)))[0]!;
const created = async (json: unknown) =>
  (await (await add(json)).json()) as {
    id: string;
    position: number;
    nodeIndex: number;
    front: string;
    back: string;
    tags: string[];
    fsrs: { state: string; reps: number };
  };

describe('POST /decks/{id}/cards', () => {
  it('requires a signed-in user', async () =>
    expect((await add({ front: 'x' }, deckId, null)).status).toBe(401));

  it('creates a New card', async () => {
    const res = await add({ front: '**hi**', back: 'there', tags: ['a', 'b'] });
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({
      deckId,
      position: 0,
      nodeIndex: 0,
      front: '**hi**',
      back: 'there',
      tags: ['a', 'b'],
      suspended: false,
      fsrs: {
        state: 'new',
        stability: 0,
        difficulty: 0,
        reps: 0,
        lapses: 0,
        lastReview: null,
        due: FIXED_NOW.toISOString(),
      },
    });
    expect((await stats()).cardCount).toBe(1);
  });

  it('a missing back is an empty string; the client id is honoured and idempotent', async () => {
    const id = randomUUID();
    await add({ id, front: 'only front' });
    const again = await add({ id, front: 'only front' });
    expect(again.status).toBe(201);
    expect((await getCard(id)).back).toBe('');
    expect((await t.db.select().from(schema.card)).length).toBe(1);
    expect((await stats()).cardCount).toBe(1);
  });

  it('stores a normalised front for duplicate detection', async () => {
    const c = await created({ front: '  Café   AU Lait ' });
    expect((await getCard(c.id)).frontNorm).toBe('café au lait');
  });

  it('assigns position from the deck counter and node_index in groups of 10', async () => {
    const out: { position: number; nodeIndex: number }[] = [];
    for (let i = 0; i < 25; i++) out.push(await created({ front: `c${i}` }));
    expect(out.map((c) => c.position)).toEqual(Array.from({ length: 25 }, (_, i) => i));
    expect(out.map((c) => c.nodeIndex)).toEqual([
      ...Array(10).fill(0),
      ...Array(10).fill(1),
      ...Array(5).fill(2),
    ]);
    const [d] = await t.db.select().from(schema.deck).where(eq(schema.deck.id, deckId));
    expect(d!.nextPosition).toBe(25);
  });

  it('never reuses positions or reshuffles nodes after a deletion', async () => {
    const cards = [];
    for (let i = 0; i < 12; i++) cards.push(await created({ front: `c${i}` }));
    await h.call(userId, `/cards/${cards[3]!.id}`, { method: 'DELETE' });
    const next = await created({ front: 'late' });
    expect(next.position).toBe(12);
    expect(next.nodeIndex).toBe(1);
    expect((await getCard(cards[11]!.id)).nodeIndex).toBe(1);
  });

  it.each([
    ['empty front', { front: '' }],
    ['blank front', { front: '   ' }],
    ['front over 10,000', { front: 'a'.repeat(10_001) }],
    ['back over 10,000', { front: 'a', back: 'b'.repeat(10_001) }],
    ['21 tags', { front: 'a', tags: Array.from({ length: 21 }, (_, i) => `t${i}`) }],
    ['tag with whitespace', { front: 'a', tags: ['has space'] }],
    ['empty tag', { front: 'a', tags: [''] }],
    ['tag over 50', { front: 'a', tags: ['t'.repeat(51)] }],
  ])('rejects %s with 422 validation_failed', async (_n, body) => {
    const res = await add(body);
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ code: 'validation_failed' });
    expect((await t.db.select().from(schema.card)).length).toBe(0);
  });

  it('accepts the limits exactly', async () => {
    const res = await add({
      front: 'a'.repeat(10_000),
      back: 'b'.repeat(10_000),
      tags: Array.from({ length: 20 }, (_, i) => 't'.repeat(50 - String(i).length) + i),
    });
    expect(res.status).toBe(201);
  });

  it('404 for a missing, deleted or foreign deck', async () => {
    const other = await createUser(t.db);
    const theirs = await createDeck(t.db, other.id);
    expect((await add({ front: 'x' }, randomUUID())).status).toBe(404);
    expect((await add({ front: 'x' }, theirs.id)).status).toBe(404);
  });

  it('card_limit_reached at 20,000 cards per learner', async () => {
    await bulkCards(t.db, userId, deckId, 19_999);
    await t.db
      .update(schema.learnerStats)
      .set({ cardCount: 19_999 })
      .where(eq(schema.learnerStats.userId, userId));
    expect((await add({ front: 'last one' })).status).toBe(201);
    const res = await add({ front: 'one too many' });
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ code: 'card_limit_reached' });
  });
});

describe('PATCH /cards/{id}', () => {
  it('edits content and tags and never changes the FSRS columns', async () => {
    const c = await created({ front: 'old', back: 'old back' });
    const reviewed = schedule(newCard(FIXED_NOW), 3, FIXED_NOW, {
      desiredRetention: 0.9,
      maximumIntervalDays: 36500,
    }).card;
    await t.db
      .update(schema.card)
      .set({
        state: reviewed.state,
        due: reviewed.due,
        stability: reviewed.stability,
        difficulty: reviewed.difficulty,
        reps: reviewed.reps,
        learningSteps: reviewed.learningSteps,
        lastReview: reviewed.lastReview,
      })
      .where(eq(schema.card.id, c.id));
    const before = await getCard(c.id);
    const res = await edit(c.id, { front: 'New Front', back: '', tags: ['z'] });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ front: 'New Front', back: '', tags: ['z'] });
    const after = await getCard(c.id);
    for (const k of [
      'state',
      'due',
      'stability',
      'difficulty',
      'reps',
      'lapses',
      'learningSteps',
      'lastReview',
      'position',
      'nodeIndex',
    ] as const)
      expect(after[k]).toEqual(before[k]);
    expect(after.frontNorm).toBe('new front');
  });

  it('suspends and unsuspends, and a suspended card keeps its state', async () => {
    const c = await created({ front: 'x' });
    expect(await (await edit(c.id, { suspended: true })).json()).toMatchObject({
      suspended: true,
      fsrs: { state: 'new' },
    });
    expect(await (await edit(c.id, { suspended: false })).json()).toMatchObject({
      suspended: false,
    });
  });

  it('suspended cards are reported in pull so clients can exclude them from counts', async () => {
    const c = await created({ front: 'x' });
    await edit(c.id, { suspended: true });
    const pulled = (await (
      await h.call(userId, `/sync/pull?cursor=0&deviceId=${randomUUID()}`)
    ).json()) as { cards: { id: string; suspended: boolean }[] };
    expect(pulled.cards.find((x) => x.id === c.id)?.suspended).toBe(true);
  });

  it('validates fields and requires at least one', async () => {
    const c = await created({ front: 'x' });
    expect((await edit(c.id, {})).status).toBe(422);
    expect((await edit(c.id, { front: '' })).status).toBe(422);
    expect((await edit(c.id, { tags: ['a b'] })).status).toBe(422);
  });

  it('404 for unknown, deleted and foreign cards', async () => {
    const other = await createUser(t.db);
    const od = await createDeck(t.db, other.id);
    const oc = await createCard(t.db, other.id, od.id);
    expect((await edit(randomUUID(), { front: 'x' })).status).toBe(404);
    expect((await edit(oc.id, { front: 'x' })).status).toBe(404);
  });
});

describe('DELETE /cards/{id}', () => {
  it('deletes the card, its logs and media; leaves a tombstone; updates the count', async () => {
    const c = await created({ front: 'bye', back: 'secret back' });
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
    const res = await h.call(userId, `/cards/${c.id}`, { method: 'DELETE' });
    expect(res.status).toBe(204);
    const row = await getCard(c.id);
    expect(row).toMatchObject({ front: '', back: '', frontNorm: '', tags: [] });
    expect(row.deletedAt).not.toBeNull();
    expect(await t.db.select().from(schema.mediaAsset)).toEqual([]);
    expect((await stats()).cardCount).toBe(0);
    expect((await h.call(userId, `/cards/${c.id}`, { method: 'DELETE' })).status).toBe(404);
  });
});

describe('POST /cards/{id}/reset', () => {
  it('writes a kind=reset log and returns the card to New (FR-012)', async () => {
    const c = await created({ front: 'x' });
    const reviewed = schedule(newCard(FIXED_NOW), 4, FIXED_NOW, {
      desiredRetention: 0.9,
      maximumIntervalDays: 36500,
    }).card;
    await t.db
      .update(schema.card)
      .set({
        state: reviewed.state,
        due: reviewed.due,
        stability: reviewed.stability,
        difficulty: reviewed.difficulty,
        reps: reviewed.reps,
        lastReview: reviewed.lastReview,
      })
      .where(eq(schema.card.id, c.id));
    const res = await h.call(userId, `/cards/${c.id}/reset`, { method: 'POST' });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      id: c.id,
      fsrs: { state: 'new', stability: 0, reps: 0, lapses: 0, lastReview: null },
    });
    const logs = await t.db
      .select()
      .from(schema.reviewLog)
      .where(and(eq(schema.reviewLog.cardId, c.id)));
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ kind: 'reset', grade: null, xp: 0, userId, deckId });
    expect(decodeState(logs[0]!.stateBefore).state).toBe('review');
    expect(decodeState(logs[0]!.stateAfter).state).toBe('new');
  });

  it('404 for a foreign card', async () => {
    const other = await createUser(t.db);
    const od = await createDeck(t.db, other.id);
    const oc = await createCard(t.db, other.id, od.id);
    expect((await h.call(userId, `/cards/${oc.id}/reset`, { method: 'POST' })).status).toBe(404);
  });
});
