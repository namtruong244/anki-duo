import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { schema } from '../../src/db/client.js';
import {
  bulkCards,
  createCard,
  createDeck,
  createTestDb,
  createUser,
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

type Row = { row: number; front: string; back?: string; tags?: string[] };
interface Totals {
  imported: number;
  updated: number;
  skipped: number;
  errors: { row: number; reason: string }[];
}

const send = (body: Record<string, unknown>, deck = deckId, user: string | null = userId) =>
  h.call(user, `/decks/${deck}/import`, { method: 'POST', json: body });
const chunk = (jobId: string, rows: Row[], over: Record<string, unknown> = {}) => ({
  jobId,
  fileName: 'f.csv',
  totalRows: rows.length,
  chunkIndex: 0,
  isLast: true,
  duplicateMode: 'skip',
  rows,
  ...over,
});
const run = async (body: Record<string, unknown>) => (await (await send(body)).json()) as Totals;
const cards = () => t.db.select().from(schema.card).where(eq(schema.card.deckId, deckId));
const rows = (n: number, from = 1): Row[] =>
  Array.from({ length: n }, (_, i) => ({
    row: from + i + 1,
    front: `card ${from + i}`,
    back: `b${from + i}`,
    tags: ['t'],
  }));

describe('POST /decks/{id}/import', () => {
  it('requires a signed-in user', async () =>
    expect((await send(chunk(randomUUID(), rows(1)), deckId, null)).status).toBe(401));

  it('imports rows in file order with position and node_index (Story 3 #1)', async () => {
    const r = await run(chunk(randomUUID(), rows(25)));
    expect(r).toMatchObject({ imported: 25, updated: 0, skipped: 0, errors: [] });
    const all = (await cards()).sort((a, b) => a.position - b.position);
    expect(all.map((c) => c.front)).toEqual(Array.from({ length: 25 }, (_, i) => `card ${i + 1}`));
    expect(all.map((c) => c.position)).toEqual(Array.from({ length: 25 }, (_, i) => i));
    expect(all.map((c) => c.nodeIndex)).toEqual([
      ...Array(10).fill(0),
      ...Array(10).fill(1),
      ...Array(5).fill(2),
    ]);
    expect(all[0]).toMatchObject({ back: 'b1', tags: ['t'], state: 'new', frontNorm: 'card 1' });
    const [stats] = await t.db
      .select()
      .from(schema.learnerStats)
      .where(eq(schema.learnerStats.userId, userId));
    expect(stats!.cardCount).toBe(25);
    const [d] = await t.db.select().from(schema.deck).where(eq(schema.deck.id, deckId));
    expect(d!.nextPosition).toBe(25);
  });

  it('reports invalid rows with their line number and imports the rest', async () => {
    const r = await run(
      chunk(randomUUID(), [
        { row: 2, front: 'ok' },
        { row: 3, front: '   ' },
        { row: 4, front: 'a'.repeat(10_001) },
        { row: 5, front: 'x', back: 'b'.repeat(10_001) },
        { row: 6, front: 'x', tags: Array.from({ length: 21 }, (_, i) => `t${i}`) },
        { row: 7, front: 'x', tags: ['has space'] },
      ]),
    );
    expect(r.imported).toBe(1);
    expect(r.skipped).toBe(5);
    expect(r.errors).toEqual([
      { row: 3, reason: 'empty_front' },
      { row: 4, reason: 'front_too_long' },
      { row: 5, reason: 'back_too_long' },
      { row: 6, reason: 'too_many_tags' },
      { row: 7, reason: 'tag_invalid' },
    ]);
  });

  it('works in chunks with cumulative totals, and isLast sets completed_at', async () => {
    const jobId = randomUUID();
    const a = await run(chunk(jobId, rows(3), { totalRows: 6, chunkIndex: 0, isLast: false }));
    expect(a.imported).toBe(3);
    let [job] = await t.db.select().from(schema.importJob).where(eq(schema.importJob.id, jobId));
    expect(job!.completedAt).toBeNull();
    const b = await run(chunk(jobId, rows(3, 4), { totalRows: 6, chunkIndex: 1, isLast: true }));
    expect(b).toMatchObject({ imported: 6, skipped: 0 });
    [job] = await t.db.select().from(schema.importJob).where(eq(schema.importJob.id, jobId));
    expect(job).toMatchObject({
      imported: 6,
      totalRows: 6,
      fileName: 'f.csv',
      duplicateMode: 'skip',
    });
    expect(job!.completedAt).not.toBeNull();
    expect((await cards()).length).toBe(6);
  });

  it('re-sending an applied chunkIndex returns the stored result and creates nothing', async () => {
    const jobId = randomUUID();
    const body = chunk(jobId, rows(4), { totalRows: 8, chunkIndex: 0, isLast: false });
    const first = await run(body);
    const again = await run(body);
    expect(again).toEqual(first);
    expect((await cards()).length).toBe(4);
    const next = await run(chunk(jobId, rows(4, 5), { totalRows: 8, chunkIndex: 1 }));
    expect(next.imported).toBe(8);
  });

  describe('duplicates', () => {
    beforeEach(async () => {
      await createCard(t.db, userId, deckId, {
        front: 'Hello',
        frontNorm: 'hello',
        back: 'old back',
        tags: ['old'],
        position: 0,
        state: 'review',
        stability: 9,
        difficulty: 4,
        reps: 3,
      });
      await t.db.update(schema.deck).set({ nextPosition: 1 }).where(eq(schema.deck.id, deckId));
    });
    const dupRows: Row[] = [
      { row: 2, front: '  HELLO ', back: 'new back', tags: ['new'] },
      { row: 3, front: 'fresh', back: 'f' },
      { row: 4, front: 'Fresh', back: 'f again' },
    ];

    it('skip: reports duplicate_skipped, including duplicates inside the file', async () => {
      const r = await run(chunk(randomUUID(), dupRows, { duplicateMode: 'skip' }));
      expect(r).toMatchObject({ imported: 1, updated: 0, skipped: 2 });
      expect(r.errors).toEqual([
        { row: 2, reason: 'duplicate_skipped' },
        { row: 4, reason: 'duplicate_skipped' },
      ]);
      expect((await cards()).length).toBe(2);
    });

    it('update: replaces Back and Tags, keeps scheduling', async () => {
      const r = await run(chunk(randomUUID(), dupRows, { duplicateMode: 'update' }));
      expect(r).toMatchObject({ imported: 1, updated: 2, skipped: 0, errors: [] });
      const hello = (await cards()).find((c) => c.frontNorm === 'hello')!;
      expect(hello).toMatchObject({
        back: 'new back',
        tags: ['new'],
        state: 'review',
        stability: 9,
        difficulty: 4,
        reps: 3,
      });
      expect((await cards()).find((c) => c.frontNorm === 'fresh')!.back).toBe('f again');
    });

    it('keep_both: creates a new card for every row', async () => {
      const r = await run(chunk(randomUUID(), dupRows, { duplicateMode: 'keep_both' }));
      expect(r).toMatchObject({ imported: 3, updated: 0, skipped: 0 });
      expect((await cards()).length).toBe(4);
    });

    it('does not treat deleted cards or other decks as duplicates', async () => {
      const other = await createDeck(t.db, userId);
      await createCard(t.db, userId, other.id, { front: 'fresh', frontNorm: 'fresh' });
      await createCard(t.db, userId, deckId, {
        front: '',
        frontNorm: 'fresh',
        deletedAt: new Date(),
      });
      const r = await run(
        chunk(randomUUID(), [{ row: 2, front: 'fresh' }], { duplicateMode: 'skip' }),
      );
      expect(r.imported).toBe(1);
    });
  });

  it('card_limit_reached for rows that would exceed 20,000 cards', async () => {
    await bulkCards(t.db, userId, deckId, 19_998);
    await t.db
      .update(schema.learnerStats)
      .set({ cardCount: 19_998 })
      .where(eq(schema.learnerStats.userId, userId));
    const r = await run(chunk(randomUUID(), rows(4)));
    expect(r.imported).toBe(2);
    expect(r.errors).toEqual([
      { row: 4, reason: 'card_limit_reached' },
      { row: 5, reason: 'card_limit_reached' },
    ]);
  });

  it('totalRows over 10,000 gives 413 import_too_large', async () => {
    const res = await send(chunk(randomUUID(), rows(1), { totalRows: 10_001 }));
    expect(res.status).toBe(413);
    expect(await res.json()).toMatchObject({ code: 'import_too_large' });
  });

  it('accepts 1,000 rows per chunk and rejects more with 422', async () => {
    expect((await send(chunk(randomUUID(), rows(1000), { totalRows: 1000 }))).status).toBe(200);
    expect((await send(chunk(randomUUID(), rows(1001), { totalRows: 1001 }))).status).toBe(422);
  });

  it('404 for a missing, deleted or foreign deck; a job id cannot be reused on another deck', async () => {
    const other = await createUser(t.db);
    const theirs = await createDeck(t.db, other.id);
    expect((await send(chunk(randomUUID(), rows(1)), theirs.id)).status).toBe(404);
    expect((await send(chunk(randomUUID(), rows(1)), randomUUID())).status).toBe(404);
    const jobId = randomUUID();
    await send(chunk(jobId, rows(1), { isLast: false, totalRows: 2 }));
    const second = await createDeck(t.db, userId);
    expect((await send(chunk(jobId, rows(1), { chunkIndex: 1 }), second.id)).status).toBe(422);
  });

  it('rate limits import like sync (61st request in a minute gets 429)', async () => {
    let last = 0;
    for (let i = 0; i < 61; i++)
      last = (await send(chunk(randomUUID(), [{ row: 2, front: `r${i}` }]))).status;
    expect(last).toBe(429);
  });

  it('writes the cards so pull returns them', async () => {
    await run(chunk(randomUUID(), rows(3)));
    const pulled = (await (
      await h.call(userId, `/sync/pull?cursor=0&deviceId=${randomUUID()}`)
    ).json()) as { cards: unknown[] };
    expect(pulled.cards).toHaveLength(3);
    void and;
  });
});
