import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import {
  decodeState,
  encodeState,
  DEFAULT_NOTE_TYPES,
  newCard,
  replay,
  schedule,
  SCHEDULER_VERSION,
  type Grade,
} from '@anki-duo/domain';
import { schema, type Db } from '../../src/db/client.js';
import { backfill0005 } from '../../src/db/backfill-0005.js';
import { createDeck, createTestDbAt, createUser, type TestDb } from '../helpers/db.js';

const params = { desiredRetention: 0.9, maximumIntervalDays: 36500 };
let t: TestDb | undefined;
afterEach(async () => t?.close());

/** Raw SQL: the schema the helpers use is newer than the migrations these tests stop at. */
async function seedLegacyUserAndDeck(db: Db) {
  const user = { id: randomUUID() };
  const deck = { id: randomUUID() };
  await db.execute(sql`
    insert into "user" (id, name, email, email_verified)
    values (${user.id}, 'Test', ${`${user.id}@example.test`}, true)`);
  await db.execute(sql`insert into learner_settings (user_id) values (${user.id})`);
  await db.execute(sql`insert into learner_stats (user_id) values (${user.id})`);
  await db.execute(sql`
    insert into deck (id, user_id, name) values (${deck.id}, ${user.id}, 'Legacy deck')`);
  return { user, deck };
}

async function insertLegacyLog(
  db: Db,
  p: { userId: string; cardId: string; deckId: string; at: Date; grade: Grade },
) {
  const state = newCard(p.at);
  await db.insert(schema.reviewLog).values({
    id: randomUUID(),
    userId: p.userId,
    cardId: p.cardId,
    deckId: p.deckId,
    kind: 'review',
    grade: p.grade,
    reviewedAt: p.at,
    stateBefore: encodeState(state),
    stateAfter: encodeState(schedule(state, p.grade, p.at, params).card),
    schedulerVersion: SCHEDULER_VERSION,
  });
}

/** Constitution Principle II: migrations must not damage review history or derived card state. */
describe('migrations keep history intact', () => {
  it('replaying every card after the final migration reproduces the stored FSRS columns', async () => {
    // Apply the migrations that predate note types, seed history, then apply the rest.
    const x = await createTestDbAt(4);
    t = x;
    const { db } = x;
    const { user, deck } = await seedLegacyUserAndDeck(db);
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

  describe('0005_interactive_cards', () => {
    it('keeps review_log byte-identical and applies card / note_type defaults', async () => {
      const x = await createTestDbAt(5);
      t = x;
      const { db, pg } = x;
      const { user, deck } = await seedLegacyUserAndDeck(db);
      const cardId = randomUUID();
      const at = new Date('2026-01-02T03:04:05.678Z');
      await db.execute(sql`
        insert into card (id, user_id, deck_id, position, node_index, front, back, front_norm)
        values (${cardId}, ${user.id}, ${deck.id}, 0, 0, 'front', 'back', 'front')`);
      await insertLegacyLog(db, { userId: user.id, cardId, deckId: deck.id, at, grade: 3 });
      await insertLegacyLog(db, { userId: user.id, cardId, deckId: deck.id, at, grade: 1 });
      const noteTypeId = randomUUID();
      await db.execute(sql`
        insert into note_type (id, user_id, name, fields, templates)
        values (${noteTypeId}, ${user.id}, 'Custom', '[]'::jsonb, '[]'::jsonb)`);

      const dump = async () =>
        (
          await pg.query<{ j: string }>(
            'select to_jsonb(r)::text as j from review_log r order by id',
          )
        ).rows;
      const before = await dump();
      expect(before).toHaveLength(2);

      await x.applyRest();

      expect(await dump()).toEqual(before);

      const [c] = (
        await pg.query<{ ordinal: number; interaction: unknown; answer_text: string }>(
          'select ordinal, interaction, answer_text from card',
        )
      ).rows;
      expect(c).toEqual({ ordinal: 0, interaction: null, answer_text: '' });
      const [nt] = (
        await pg.query<{ kind: string; options: unknown; builtin_key: string | null }>(
          'select kind, options, builtin_key from note_type',
        )
      ).rows;
      expect(nt).toEqual({ kind: 'standard', options: {}, builtin_key: null });
    });

    it('backfills builtin_key for rows matching the three 001 built-ins only', async () => {
      const x = await createTestDbAt(5);
      t = x;
      const { db, pg } = x;
      const { user } = await seedLegacyUserAndDeck(db);
      const ids: Record<string, string> = {};
      const defs = DEFAULT_NOTE_TYPES.slice(0, 3);
      for (const d of defs) {
        ids[d.key] = randomUUID();
        await db.execute(sql`
          insert into note_type (id, user_id, name, fields, templates, css)
          values (${ids[d.key]}, ${user.id}, ${d.name}, ${JSON.stringify(d.def.fields)}::jsonb,
                  ${JSON.stringify(d.def.templates)}::jsonb, ${d.def.css})`);
      }
      // Same name as a built-in but edited templates: left unmatched.
      const edited = randomUUID();
      await db.execute(sql`
        insert into note_type (id, user_id, name, fields, templates)
        values (${edited}, ${user.id}, 'Basic edited', '[]'::jsonb,
                '[{"id":"t_card1","name":"Card 1","front":"{{Front}}!","back":"{{Back}}"}]'::jsonb)`);

      await x.applyRest();

      const rows = (
        await pg.query<{ id: string; builtin_key: string | null }>(
          'select id, builtin_key from note_type',
        )
      ).rows;
      const key = (id: string) => rows.find((r) => r.id === id)?.builtin_key;
      for (const d of defs) expect(key(ids[d.key]!)).toBe(d.key);
      expect(key(edited)).toBeNull();
    });

    it('backfill-0005 fills a Basic card answer_text from its back-only fields, touching nothing else', async () => {
      const x = await createTestDbAt(5);
      t = x;
      const { db, pg } = x;
      const { user, deck } = await seedLegacyUserAndDeck(db);
      const basic = DEFAULT_NOTE_TYPES[0]!;
      const typeId = randomUUID();
      await db.execute(sql`
        insert into note_type (id, user_id, name, fields, templates, css)
        values (${typeId}, ${user.id}, ${basic.name}, ${JSON.stringify(basic.def.fields)}::jsonb,
                ${JSON.stringify(basic.def.templates)}::jsonb, ${basic.def.css})`);
      const noteId = randomUUID();
      await db.execute(sql`
        insert into note (id, user_id, deck_id, note_type_id, fields)
        values (${noteId}, ${user.id}, ${deck.id}, ${typeId},
                ${JSON.stringify({ f_front: 'Capital of France?', f_back: '<b>Paris</b>' })}::jsonb)`);
      const cardId = randomUUID();
      await db.execute(sql`
        insert into card (id, user_id, deck_id, position, node_index, front, back, front_norm,
                          note_id, note_type_id, template_id, format, reps, state, stability)
        values (${cardId}, ${user.id}, ${deck.id}, 0, 0, 'f', 'b', 'f', ${noteId}, ${typeId},
                't_card1', 'html', 3, 'review', 4.5)`);
      await insertLegacyLog(db, {
        userId: user.id,
        cardId,
        deckId: deck.id,
        at: new Date('2026-01-02T00:00:00Z'),
        grade: 3,
      });
      await x.applyRest();

      const snapshot = async () =>
        (
          await pg.query<{ j: string }>(
            `select to_jsonb(c) - 'answer_text' - 'interaction' - 'change_seq' as j from card c`,
          )
        ).rows;
      const logs = async () =>
        (await pg.query<{ j: string }>('select to_jsonb(r)::text as j from review_log r')).rows;
      const cardBefore = await snapshot();
      const logsBefore = await logs();

      expect(await backfill0005(db)).toBe(1);
      const [row] = (
        await pg.query<{ answer_text: string }>('select answer_text from card where id = $1', [
          cardId,
        ])
      ).rows;
      expect(row!.answer_text).toBe('Paris');
      expect(await snapshot()).toEqual(cardBefore);
      expect(await logs()).toEqual(logsBefore);

      // Idempotent: a second run changes nothing.
      expect(await backfill0005(db)).toBe(0);
    });
  });
});
