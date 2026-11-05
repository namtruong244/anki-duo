import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { newCard, replay, type Grade } from '@anki-duo/domain';
import { schema } from '../../src/db/client.js';
import { seed } from '../../scripts/seed.js';
import { createTestDb, type TestDb } from '../helpers/db.js';

const NOW = new Date('2026-03-01T12:00:00Z');
let t: TestDb;
afterEach(() => t.close());

describe('seed script', () => {
  it('builds history whose replay reproduces every card (except the nudged due-now cards)', async () => {
    t = await createTestDb();
    const r = await seed(t.db, { now: NOW });
    expect(r.cards).toBe(105);
    const decks = await t.db.select().from(schema.deck);
    expect(decks.map((d) => d.name).sort()).toEqual([
      'English idioms',
      'Media sample',
      'Từ vựng N3',
    ]);
    const cards = await t.db.select().from(schema.card);
    const logs = await t.db.select().from(schema.reviewLog);
    expect(logs.length).toBeGreaterThan(500);
    for (const c of cards) {
      const mine = logs.filter((l) => l.cardId === c.id);
      const replayed = replay(
        newCard(c.createdAt),
        mine.map((l) => ({
          id: l.id,
          kind: 'review' as const,
          grade: l.grade as Grade,
          reviewedAt: l.reviewedAt,
          revokedAt: null,
        })),
        { desiredRetention: 0.9, maximumIntervalDays: 36500 },
      );
      expect({ state: c.state, stability: c.stability, reps: c.reps, lapses: c.lapses }).toEqual({
        state: replayed.state,
        stability: replayed.stability,
        reps: replayed.reps,
        lapses: replayed.lapses,
      });
    }
    const [stats] = await t.db.select().from(schema.learnerStats);
    expect(stats!.cardCount).toBe(105);
    expect(stats!.totalXp).toBe(logs.length * 2);
  });

  it('due25 leaves 25 learning cards due now in Từ vựng N3', async () => {
    t = await createTestDb();
    await seed(t.db, { scenario: 'due25', now: NOW });
    const [n3] = await t.db.select().from(schema.deck).where(eq(schema.deck.name, 'Từ vựng N3'));
    const cards = await t.db.select().from(schema.card).where(eq(schema.card.deckId, n3!.id));
    expect(cards.filter((c) => c.state !== 'new' && c.due <= NOW && c.reps === 1)).toHaveLength(25);
  });

  it('can be re-run (replaces the demo learner)', async () => {
    t = await createTestDb();
    await seed(t.db, { now: NOW });
    await seed(t.db, { now: NOW });
    expect(await t.db.select().from(schema.user)).toHaveLength(1);
  });
});
