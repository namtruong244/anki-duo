/* eslint-disable @typescript-eslint/no-explicit-any -- the export document is untyped JSON in these tests */
import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { newCard, SCHEDULER_VERSION, type Grade } from '@anki-duo/domain';
import { schema } from '../../src/db/client.js';
import { createCard, createDeck, createTestDb, type TestDb } from '../helpers/db.js';
import { appAs } from '../helpers/session.js';
import { fakeStorage } from '../helpers/storage.js';

let t: TestDb;
let h: ReturnType<typeof appAs>;
let fs: ReturnType<typeof fakeStorage>;
let userId: string;
let deckId: string;

beforeEach(async () => {
  t = await createTestDb();
  fs = fakeStorage();
  h = appAs(t.db, { storage: fs.storage });
  userId = (await h.newUser()).id;
  const deck = await createDeck(t.db, userId, { name: 'Từ vựng' });
  deckId = deck.id;
});
afterEach(() => t.close());

/** Builds a card with real history through the push API, so the stored state is the server's truth. */
async function cardWithHistory(position: number, grades: Grade[]) {
  const created = new Date('2026-01-01T00:00:00Z');
  const c = await createCard(t.db, userId, deckId, {
    position,
    nodeIndex: Math.floor(position / 10),
    front: `front ${position}`,
    back: `back ${position}`,
    createdAt: created,
    due: newCard(created).due,
    tags: ['a', 'b'],
  });
  const at = Date.parse('2026-02-01T09:00:00Z');
  const events = grades.map((grade, i) => ({
    type: 'review',
    id: randomUUID(),
    cardId: c.id,
    sessionId: randomUUID(),
    grade,
    reviewedAt: new Date(at + i * 86_400_000).toISOString(),
    durationMs: 1000,
    schedulerVersion: SCHEDULER_VERSION,
    stateBefore: {
      state: 'new',
      due: created.toISOString(),
      stability: 0,
      difficulty: 0,
      learningSteps: 0,
      reps: 0,
      lapses: 0,
      lastReview: null,
    },
    stateAfter: {
      state: 'new',
      due: created.toISOString(),
      stability: 0,
      difficulty: 0,
      learningSteps: 0,
      reps: 0,
      lapses: 0,
      lastReview: null,
    },
  }));
  if (events.length) {
    const res = await h.call(userId, '/sync/push', {
      method: 'POST',
      json: { deviceId: randomUUID(), events },
    });
    expect(res.status).toBe(200);
  }
  return { card: c, events };
}

const exportDeck = async (id = deckId) => {
  const res = await h.call(userId, `/decks/${id}/export`);
  expect(res.status).toBe(200);
  return (await res.json()) as any;
};
const restore = (doc: unknown) => h.call(userId, '/decks/restore', { method: 'POST', json: doc });

describe('GET /decks/{id}/export', () => {
  it('requires a user and a live deck of their own', async () => {
    expect((await h.call(null, `/decks/${deckId}/export`)).status).toBe(401);
    expect((await h.call(userId, `/decks/${randomUUID()}/export`)).status).toBe(404);
  });

  it('contains format, version, scheduler parameters, cards, full history (including revoked) and a media manifest', async () => {
    const { card, events } = await cardWithHistory(0, [3, 3, 4]);
    await h.call(userId, '/sync/push', {
      method: 'POST',
      json: {
        deviceId: randomUUID(),
        events: [
          {
            type: 'revoke',
            id: randomUUID(),
            reviewId: events[2]!.id,
            revokedAt: '2026-02-10T00:00:00.000Z',
          },
        ],
      },
    });
    const bytes = new TextEncoder().encode('png-bytes');
    const mid = randomUUID();
    await t.db.insert(schema.mediaAsset).values({
      id: mid,
      userId,
      cardId: card.id,
      side: 'front',
      kind: 'image',
      mime: 'image/png',
      bytes: bytes.length,
      storageKey: `u/${userId}/${mid}`,
      status: 'ready',
    });
    fs.upload(`u/${userId}/${mid}`, bytes, 'image/png');

    const doc = await exportDeck();
    expect(doc).toMatchObject({
      format: 'anki-duo-export',
      version: 1,
      deck: { id: deckId, name: 'Từ vựng', newCardsPerDay: 20 },
    });
    expect(doc.scheduler).toMatchObject({
      algorithm: 'fsrs-6',
      desiredRetention: 0.9,
      maximumIntervalDays: 36500,
    });
    expect(doc.scheduler.parameters).toHaveLength(21);
    expect(doc.scheduler.implementation).toMatch(/^ts-fsrs@/);
    expect(doc.cards).toHaveLength(1);
    expect(doc.cards[0]).toMatchObject({
      id: card.id,
      front: 'front 0',
      tags: ['a', 'b'],
      fsrs: { state: 'review', reps: 2 },
    });
    expect(doc.reviews).toHaveLength(3);
    expect(doc.reviews.map((r: any) => r.revokedAt !== null)).toEqual([false, false, true]);
    expect(doc.cards[0].media).toEqual([
      expect.objectContaining({
        id: mid,
        side: 'front',
        kind: 'image',
        mime: 'image/png',
        bytes: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        url: expect.stringContaining('exp=604800'),
      }),
    ]);
  });

  it('orders reviews by (reviewedAt, id) and sets an attachment filename', async () => {
    await cardWithHistory(0, [3, 3]);
    const res = await h.call(userId, `/decks/${deckId}/export`);
    expect(res.headers.get('content-disposition')).toContain('.anki-duo.json');
    const doc = (await res.json()) as any;
    const times = doc.reviews.map((r: any) => r.reviewedAt);
    expect([...times].sort()).toEqual(times);
  });
});

describe('POST /decks/restore', () => {
  it('creates a new deck with new ids and identical FSRS state for every card (V11)', async () => {
    await cardWithHistory(0, [3, 3, 4]);
    await cardWithHistory(1, [1, 3]);
    await cardWithHistory(2, []);
    const doc = await exportDeck();
    const res = await restore(doc);
    expect(res.status).toBe(201);
    const deck = (await res.json()) as { id: string; name: string };
    expect(deck.id).not.toBe(deckId);

    const restored = await t.db.select().from(schema.card).where(eq(schema.card.deckId, deck.id));
    expect(restored).toHaveLength(3);
    const original = await t.db.select().from(schema.card).where(eq(schema.card.deckId, deckId));
    const pick = (c: typeof schema.card.$inferSelect) => ({
      front: c.front,
      tags: c.tags,
      position: c.position,
      nodeIndex: c.nodeIndex,
      state: c.state,
      due: c.due,
      stability: c.stability,
      difficulty: c.difficulty,
      learningSteps: c.learningSteps,
      reps: c.reps,
      lapses: c.lapses,
      lastReview: c.lastReview,
    });
    const sortBy = (a: any, b: any) => a.position - b.position;
    expect(restored.map(pick).sort(sortBy)).toEqual(original.map(pick).sort(sortBy));
    expect(new Set([...restored, ...original].map((c) => c.id)).size).toBe(6);

    const logs = await t.db
      .select()
      .from(schema.reviewLog)
      .where(eq(schema.reviewLog.deckId, deck.id));
    expect(logs).toHaveLength(5);
    const oldLogs = await t.db
      .select()
      .from(schema.reviewLog)
      .where(eq(schema.reviewLog.deckId, deckId));
    expect(logs.map((l) => l.id).filter((i) => oldLogs.some((o) => o.id === i))).toEqual([]);
    const [stats] = await t.db
      .select()
      .from(schema.learnerStats)
      .where(eq(schema.learnerStats.userId, userId));
    expect(stats!.cardCount).toBe(3);
  });

  it('keeps revoked history revoked', async () => {
    const { events } = await cardWithHistory(0, [3, 4]);
    await h.call(userId, '/sync/push', {
      method: 'POST',
      json: {
        deviceId: randomUUID(),
        events: [
          {
            type: 'revoke',
            id: randomUUID(),
            reviewId: events[1]!.id,
            revokedAt: '2026-02-10T00:00:00.000Z',
          },
        ],
      },
    });
    const deck = (await (await restore(await exportDeck())).json()) as { id: string };
    const logs = await t.db
      .select()
      .from(schema.reviewLog)
      .where(eq(schema.reviewLog.deckId, deck.id));
    expect(logs.filter((l) => l.revokedAt !== null)).toHaveLength(1);
  });

  it('gives the restored deck a free name when the original still exists', async () => {
    const doc = await exportDeck();
    const a = (await (await restore(doc)).json()) as { name: string };
    const b = (await (await restore(doc)).json()) as { name: string };
    expect(new Set(['Từ vựng', a.name, b.name]).size).toBe(3);
  });

  it('a tampered history fails with 422 export_invalid and creates nothing', async () => {
    await cardWithHistory(0, [3, 3]);
    const doc = await exportDeck();
    doc.reviews[1].grade = 1; // history no longer reproduces the exported state
    const before = (await t.db.select().from(schema.deck)).length;
    const res = await restore(doc);
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ code: 'export_invalid' });
    expect((await t.db.select().from(schema.deck)).length).toBe(before);
    expect((await t.db.select().from(schema.card)).length).toBe(1);
  });

  it.each([[{ format: 'other' }], [{ version: 2 }], [{ cards: 'nope' }]])(
    'rejects a malformed file %j with export_invalid',
    async (patch) => {
      const doc = { ...(await exportDeck()), ...patch };
      const res = await restore(doc);
      expect(res.status).toBe(422);
      expect(await res.json()).toMatchObject({ code: 'export_invalid' });
    },
  );

  it('ignores unknown fields (v1 readers)', async () => {
    const doc = { ...(await exportDeck()), futureField: { x: 1 } };
    expect((await restore(doc)).status).toBe(201);
  });

  it('applies the 20,000-card limit with card_limit_reached', async () => {
    await cardWithHistory(0, []);
    const doc = await exportDeck();
    await t.db
      .update(schema.learnerStats)
      .set({ cardCount: 20_000 })
      .where(eq(schema.learnerStats.userId, userId));
    const res = await restore(doc);
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ code: 'card_limit_reached' });
    expect((await t.db.select().from(schema.deck)).length).toBe(1);
  });

  it('turns media references into plain text since the files are not copied', async () => {
    const { card } = await cardWithHistory(0, []);
    await t.db
      .update(schema.card)
      .set({ front: 'see ![pic](media:abc) and [[audio:def]]' })
      .where(eq(schema.card.id, card.id));
    const deck = (await (await restore(await exportDeck())).json()) as { id: string };
    const [c] = await t.db.select().from(schema.card).where(eq(schema.card.deckId, deck.id));
    expect(c!.front).not.toContain('media:');
    expect(c!.front).not.toContain('[[audio');
  });
});
