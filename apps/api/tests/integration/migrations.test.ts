import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import {
  decodeState,
  encodeState,
  newCard,
  replay,
  schedule,
  SCHEDULER_VERSION,
  type Grade,
} from '@anki-duo/domain';
import { schema } from '../../src/db/client.js';
import { createDeck, createTestDbAt, createUser, type TestDb } from '../helpers/db.js';

const params = { desiredRetention: 0.9, maximumIntervalDays: 36500 };
let t: TestDb | undefined;
afterEach(async () => t?.close());

/** Constitution Principle II: migrations must not damage review history or derived card state. */
describe('migrations keep history intact', () => {
  it('replaying every card after the final migration reproduces the stored FSRS columns', async () => {
    // Apply the migrations that predate note types, seed history, then apply the rest.
    const x = await createTestDbAt(4);
    t = x;
    const { db } = x;
    const user = await createUser(db);
    const deck = await createDeck(db, user.id);
    const created = new Date('2026-01-01T00:00:00Z');

    const seeded: { id: string; expected: ReturnType<typeof newCard> }[] = [];
    for (let i = 0; i < 5; i++) {
      let state = newCard(created);
      // Raw SQL: the card table at this point predates the columns the current schema adds.
      const card = { id: randomUUID() };
      await db.execute(sql`
        insert into card (id, user_id, deck_id, position, node_index, front, back, front_norm, due)
        values (${card.id}, ${user.id}, ${deck.id}, ${i}, 0, 'front', 'back', 'front', ${created.toISOString()})`);
      let at = created.getTime();
      for (const grade of [3, 3, 4, 1, 3, 3].slice(0, 2 + i) as Grade[]) {
        at = Math.max(at, state.due.getTime());
        const next = schedule(state, grade, new Date(at), params);
        await db.insert(schema.reviewLog).values({
          id: randomUUID(),
          userId: user.id,
          cardId: card.id,
          deckId: deck.id,
          kind: 'review',
          grade,
          reviewedAt: new Date(at),
          stateBefore: encodeState(state),
          stateAfter: encodeState(next.card),
          schedulerVersion: SCHEDULER_VERSION,
        });
        state = next.card;
      }
      await db
        .update(schema.card)
        .set({
          state: state.state,
          due: state.due,
          stability: state.stability,
          difficulty: state.difficulty,
          learningSteps: state.learningSteps,
          reps: state.reps,
          lapses: state.lapses,
          lastReview: state.lastReview,
        })
        .where(eq(schema.card.id, card.id));
      seeded.push({ id: card.id, expected: state });
    }

    await x.applyRest();

    for (const { id, expected } of seeded) {
      const [row] = await db.select().from(schema.card).where(eq(schema.card.id, id));
      const logs = await db.select().from(schema.reviewLog).where(eq(schema.reviewLog.cardId, id));
      const replayed = replay(
        newCard(created),
        logs.map((l) => ({
          id: l.id,
          kind: l.kind as 'review' | 'reset',
          grade: l.grade as Grade | null,
          reviewedAt: l.reviewedAt,
          revokedAt: l.revokedAt,
        })),
        params,
      );
      expect(replayed).toEqual(expected);
      expect(decodeState(encodeState(replayed))).toEqual(replayed);
      expect({
        state: row!.state,
        due: row!.due,
        stability: row!.stability,
        difficulty: row!.difficulty,
        learningSteps: row!.learningSteps,
        reps: row!.reps,
        lapses: row!.lapses,
        lastReview: row!.lastReview,
      }).toEqual(expected);
    }
  });

  it('change_seq triggers assign increasing values on insert and update', async () => {
    const x = await createTestDbAt(99);
    t = x;
    const user = await createUser(x.db);
    const deck = await createDeck(x.db, user.id);
    const [a] = await x.db.select().from(schema.deck).where(eq(schema.deck.id, deck.id));
    await x.db.update(schema.deck).set({ name: 'renamed' }).where(eq(schema.deck.id, deck.id));
    const [b] = await x.db.select().from(schema.deck).where(eq(schema.deck.id, deck.id));
    expect(a!.changeSeq).toBeGreaterThan(0);
    expect(b!.changeSeq).toBeGreaterThan(a!.changeSeq!);
  });

  it('enforces the documented constraints', async () => {
    const x = await createTestDbAt(99);
    t = x;
    const user = await createUser(x.db);
    await createDeck(x.db, user.id, { name: 'Same' });
    await expect(createDeck(x.db, user.id, { name: 'same' })).rejects.toThrow();
    await expect(
      x.db
        .update(schema.learnerSettings)
        .set({ dailyXpGoal: 15 })
        .where(eq(schema.learnerSettings.userId, user.id)),
    ).rejects.toThrow();
  });
});
