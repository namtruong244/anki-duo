import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { schema } from '../../src/db/client.js';
import { createCard, createDeck, createTestDb, createUser, type TestDb } from '../helpers/db.js';
import { appAs } from '../helpers/session.js';
import { fakeStorage } from '../helpers/storage.js';

/**
 * Every /api/v1 route that takes an id must refuse another learner's id (FR-030, security).
 * Alice owns everything; Bob tries each route with Alice's ids.
 */
let t: TestDb;
let h: ReturnType<typeof appAs>;
let alice: string;
let bob: string;
let deckId: string;
let cardId: string;
let mediaId: string;
let reviewId: string;
const deviceId = randomUUID();

beforeEach(async () => {
  t = await createTestDb();
  h = appAs(t.db, { storage: fakeStorage().storage });
  alice = (await createUser(t.db)).id;
  bob = (await createUser(t.db)).id;
  deckId = (await createDeck(t.db, alice, { name: 'Alice deck' })).id;
  cardId = (await createCard(t.db, alice, deckId, { createdAt: new Date('2026-01-01T00:00:00Z') }))
    .id;
  mediaId = randomUUID();
  await t.db
    .insert(schema.mediaAsset)
    .values({
      id: mediaId,
      userId: alice,
      cardId,
      side: 'front',
      kind: 'image',
      mime: 'image/png',
      bytes: 5,
      storageKey: `u/${alice}/m`,
      status: 'ready',
    });
  const fsrs = {
    state: 'new',
    due: '2026-01-01T00:00:00.000Z',
    stability: 0,
    difficulty: 0,
    learningSteps: 0,
    reps: 0,
    lapses: 0,
    lastReview: null,
  };
  reviewId = randomUUID();
  const r = await h.call(alice, '/sync/push', {
    method: 'POST',
    json: {
      deviceId,
      events: [
        {
          type: 'review',
          id: reviewId,
          cardId,
          sessionId: randomUUID(),
          grade: 3,
          reviewedAt: '2026-02-01T10:00:00.000Z',
          durationMs: 10,
          schedulerVersion: 'x',
          stateBefore: fsrs,
          stateAfter: fsrs,
        },
      ],
    },
  });
  expect(r.status).toBe(200);
});
afterEach(() => t.close());

const asBob = (path: string, init: RequestInit & { json?: unknown } = {}) =>
  h.call(bob, path, init);

describe("another learner's ids are refused", () => {
  const cases: [string, string, string, unknown?][] = [
    ['PATCH deck', 'PATCH', '/decks/{deck}', { name: 'hijack' }],
    ['DELETE deck', 'DELETE', '/decks/{deck}'],
    ['POST card in deck', 'POST', '/decks/{deck}/cards', { front: 'x' }],
    ['PATCH card', 'PATCH', '/cards/{card}', { front: 'hijack' }],
    ['DELETE card', 'DELETE', '/cards/{card}'],
    ['POST reset card', 'POST', '/cards/{card}/reset'],
    [
      'POST import',
      'POST',
      '/decks/{deck}/import',
      {
        jobId: '00000000-0000-4000-8000-000000000001',
        fileName: 'f',
        totalRows: 1,
        chunkIndex: 0,
        duplicateMode: 'skip',
        rows: [{ row: 2, front: 'x' }],
      },
    ],
    ['GET export', 'GET', '/decks/{deck}/export'],
    ['POST media complete', 'POST', '/media/{media}/complete'],
    ['GET media', 'GET', '/media/{media}'],
    ['DELETE media', 'DELETE', '/media/{media}'],
    [
      'POST media upload-url for the card',
      'POST',
      '/media/upload-url',
      { cardId: '{card}', side: 'front', mime: 'image/png', bytes: 10 },
    ],
  ];

  it.each(cases)('%s gives 404', async (_n, method, path, body) => {
    const fill = (s: string) =>
      s.replace('{deck}', deckId).replace('{card}', cardId).replace('{media}', mediaId);
    const json = body === undefined ? undefined : JSON.parse(fill(JSON.stringify(body)));
    const res = await asBob(fill(path), { method, ...(json !== undefined ? { json } : {}) });
    expect(res.status).toBe(404);
  });

  it("nothing of Alice's changed", async () => {
    for (const [, method, path, body] of cases) {
      const fill = (s: string) =>
        s.replace('{deck}', deckId).replace('{card}', cardId).replace('{media}', mediaId);
      await asBob(fill(path), {
        method,
        ...(body !== undefined ? { json: JSON.parse(fill(JSON.stringify(body))) } : {}),
      });
    }
    const [deck] = await t.db.select().from(schema.deck).where(eq(schema.deck.id, deckId));
    const [card] = await t.db.select().from(schema.card).where(eq(schema.card.id, cardId));
    const [media] = await t.db
      .select()
      .from(schema.mediaAsset)
      .where(eq(schema.mediaAsset.id, mediaId));
    expect(deck).toMatchObject({ name: 'Alice deck', deletedAt: null });
    expect(card).toMatchObject({ front: 'front', deletedAt: null, reps: 1 });
    expect(media!.deletedAt).toBeNull();
    expect(
      await t.db.select().from(schema.reviewLog).where(eq(schema.reviewLog.userId, alice)),
    ).toHaveLength(1);
    expect(await t.db.select().from(schema.card).where(eq(schema.card.userId, bob))).toEqual([]);
  });

  it("push refuses Alice's card, review and deck", async () => {
    const fsrs = {
      state: 'new',
      due: '2026-01-01T00:00:00.000Z',
      stability: 0,
      difficulty: 0,
      learningSteps: 0,
      reps: 0,
      lapses: 0,
      lastReview: null,
    };
    const events = [
      {
        type: 'review',
        id: randomUUID(),
        cardId,
        sessionId: randomUUID(),
        grade: 3,
        reviewedAt: '2026-02-02T10:00:00.000Z',
        durationMs: 1,
        schedulerVersion: 'x',
        stateBefore: fsrs,
        stateAfter: fsrs,
      },
      { type: 'revoke', id: randomUUID(), reviewId, revokedAt: '2026-02-02T10:00:00.000Z' },
      {
        type: 'session',
        id: randomUUID(),
        deckId,
        kind: 'review',
        nodeIndex: null,
        startedAt: '2026-02-02T10:00:00.000Z',
        endedAt: null,
        plannedCount: 1,
        cardsReviewed: 0,
        correctCount: 0,
        completed: false,
      },
    ];
    const res = await h.call(bob, '/sync/push', {
      method: 'POST',
      json: { deviceId: randomUUID(), events },
    });
    const { results } = (await res.json()) as { results: { status: string }[] };
    expect(results.map((r) => r.status)).toEqual(['rejected', 'rejected', 'rejected']);
    const [log] = await t.db
      .select()
      .from(schema.reviewLog)
      .where(eq(schema.reviewLog.id, reviewId));
    expect(log!.revokedAt).toBeNull();
  });

  it("pull never includes Alice's data for Bob, and settings changes stay per user", async () => {
    const pulled = (await (await asBob(`/sync/pull?cursor=0&deviceId=${randomUUID()}`)).json()) as {
      decks: unknown[];
      cards: unknown[];
      media: unknown[];
    };
    expect(pulled.decks).toEqual([]);
    expect(pulled.cards).toEqual([]);
    expect(pulled.media).toEqual([]);
    await asBob('/me/settings', { method: 'PATCH', json: { sessionSize: 50 } });
    const [a] = await t.db
      .select()
      .from(schema.learnerSettings)
      .where(eq(schema.learnerSettings.userId, alice));
    expect(a!.sessionSize).toBe(20);
  });

  it("a user can reuse another learner's client-chosen ids only for their own rows (no takeover)", async () => {
    const res = await asBob(`/decks/${deckId}/cards`, {
      method: 'POST',
      json: { id: cardId, front: 'steal' },
    });
    expect(res.status).toBe(404);
    const dup = await asBob('/decks', { method: 'POST', json: { id: deckId, name: 'Bobs' } });
    expect([201, 409, 422, 500]).toContain(dup.status);
    const [deck] = await t.db.select().from(schema.deck).where(eq(schema.deck.id, deckId));
    expect(deck).toMatchObject({ userId: alice, name: 'Alice deck' });
  });
});
