import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { schema } from '../../src/db/client.js';
import { createCard, createDeck, createTestDb, createUser, type TestDb } from '../helpers/db.js';
import { appAs } from '../helpers/session.js';

let t: TestDb;
let h: ReturnType<typeof appAs>;
let userId: string;
const deviceId = randomUUID();

beforeEach(async () => {
  t = await createTestDb();
  h = appAs(t.db);
  userId = (await h.newUser()).id;
});
afterEach(() => t.close());

interface Pull {
  cursor: string;
  hasMore: boolean;
  settings: { sessionSize: number } | null;
  stats: { cardCount: number } | null;
  decks: { id: string; name: string; deletedAt: string | null }[];
  cards: {
    id: string;
    front: string;
    back: string;
    tags: string[];
    deletedAt: string | null;
    fsrs: { state: string };
  }[];
  media: { id: string; deletedAt: string | null }[];
  dailyActivity: { studyDay: string }[];
}
const pull = async (cursor: string, extra = '', user: string | null = userId): Promise<Response> =>
  h.call(user, `/sync/pull?cursor=${cursor}&deviceId=${deviceId}${extra}`);
const pullJson = async (cursor: string, extra = '') =>
  (await (await pull(cursor, extra)).json()) as Pull;

async function seed(n = 5) {
  const deck = await createDeck(t.db, userId);
  const cards = [];
  for (let i = 0; i < n; i++)
    cards.push(await createCard(t.db, userId, deck.id, { position: i, front: `f${i}` }));
  return { deck, cards };
}

describe('GET /api/v1/sync/pull', () => {
  it('requires a signed-in user', async () => {
    expect((await pull('0', '', null)).status).toBe(401);
  });

  it('returns everything for cursor 0, including settings and stats', async () => {
    const { deck, cards } = await seed(3);
    const body = await pullJson('0');
    expect(body.hasMore).toBe(false);
    expect(body.settings).toMatchObject({ sessionSize: 20 });
    expect(body.stats).toMatchObject({ cardCount: 0 });
    expect(body.decks.map((d) => d.id)).toEqual([deck.id]);
    expect(body.cards.map((c) => c.id).sort()).toEqual(cards.map((c) => c.id).sort());
    expect(body.cards[0]!.fsrs.state).toBe('new');
    expect(Number(body.cursor)).toBeGreaterThan(0);
  });

  it('pages with limit and hasMore until everything is delivered exactly once', async () => {
    const { cards } = await seed(7);
    const seen: string[] = [];
    let cursor = '0';
    let pages = 0;
    for (;;) {
      const body = await pullJson(cursor, '&limit=3');
      pages++;
      seen.push(...body.cards.map((c) => c.id));
      const rows =
        body.decks.length +
        body.cards.length +
        body.media.length +
        body.dailyActivity.length +
        (body.settings ? 1 : 0) +
        (body.stats ? 1 : 0);
      expect(rows).toBeLessThanOrEqual(3);
      cursor = body.cursor;
      if (!body.hasMore) break;
      expect(pages).toBeLessThan(20);
    }
    expect(seen.sort()).toEqual(cards.map((c) => c.id).sort());
    expect(new Set(seen).size).toBe(seen.length);
  });

  it('returns only rows changed after the cursor, in change_seq order', async () => {
    const { cards } = await seed(3);
    const first = await pullJson('0');
    expect((await pullJson(first.cursor)).cards).toEqual([]);
    await t.db.update(schema.card).set({ front: 'edited' }).where(eq(schema.card.id, cards[1]!.id));
    const next = await pullJson(first.cursor);
    expect(next.cards.map((c) => [c.id, c.front])).toEqual([[cards[1]!.id, 'edited']]);
    expect(next.decks).toEqual([]);
    expect(BigInt(next.cursor)).toBeGreaterThan(BigInt(first.cursor));
  });

  it('keeps the cursor unchanged when nothing is new', async () => {
    await seed(1);
    const first = await pullJson('0');
    expect((await pullJson(first.cursor)).cursor).toBe(first.cursor);
  });

  it('sends tombstones with content omitted for deleted decks, cards and media', async () => {
    const { deck, cards } = await seed(2);
    const media = (
      await t.db
        .insert(schema.mediaAsset)
        .values({
          id: randomUUID(),
          userId,
          cardId: cards[0]!.id,
          side: 'front',
          kind: 'image',
          mime: 'image/png',
          bytes: 10,
          storageKey: 'k',
          status: 'ready',
        })
        .returning()
    )[0]!;
    const first = await pullJson('0');
    const now = new Date();
    await t.db
      .update(schema.mediaAsset)
      .set({ deletedAt: now })
      .where(eq(schema.mediaAsset.id, media.id));
    await t.db
      .update(schema.card)
      .set({ deletedAt: now, front: '', back: '', frontNorm: '', tags: [] })
      .where(eq(schema.card.id, cards[0]!.id));
    await t.db
      .update(schema.deck)
      .set({ deletedAt: now, name: '' })
      .where(eq(schema.deck.id, deck.id));
    const body = await pullJson(first.cursor);
    expect(body.decks).toMatchObject([{ id: deck.id, name: '', deletedAt: expect.any(String) }]);
    expect(body.cards).toMatchObject([
      { id: cards[0]!.id, front: '', back: '', tags: [], deletedAt: expect.any(String) },
    ]);
    expect(body.media).toMatchObject([{ id: media.id, deletedAt: expect.any(String) }]);
  });

  it("never returns another user's rows", async () => {
    await seed(2);
    const other = await createUser(t.db);
    const od = await createDeck(t.db, other.id, { name: 'secret' });
    await createCard(t.db, other.id, od.id, { front: 'secret' });
    const body = await pullJson('0');
    expect(JSON.stringify(body)).not.toContain('secret');
    const theirs = (await (await pull('0', '', other.id)).json()) as Pull;
    expect(theirs.decks.map((d) => d.name)).toEqual(['secret']);
  });

  it('includes daily activity', async () => {
    await t.db
      .insert(schema.dailyActivity)
      .values({ userId, studyDay: '2026-03-01', reviews: 4, xp: 8, goalXp: 20 });
    expect((await pullJson('0')).dailyActivity).toMatchObject([
      { studyDay: '2026-03-01', reviews: 4, xp: 8, goalXp: 20, goalMet: false },
    ]);
  });

  it('updates Device.last_pull_seq and last_seen_at', async () => {
    await seed(1);
    const body = await pullJson('0');
    const [d] = await t.db.select().from(schema.device).where(eq(schema.device.id, deviceId));
    expect(d).toMatchObject({ userId, lastPullSeq: Number(body.cursor) });
    expect(d!.lastSeenAt.toISOString()).toBe('2026-03-01T12:00:00.000Z');
  });

  it('does not let a device id belonging to someone else be taken over', async () => {
    const other = await createUser(t.db);
    await t.db.insert(schema.device).values({ id: deviceId, userId: other.id, label: 'x' });
    expect((await pull('0')).status).toBe(200);
    const [d] = await t.db.select().from(schema.device).where(eq(schema.device.id, deviceId));
    expect(d!.userId).toBe(other.id);
  });

  it.each([['&limit=0'], ['&limit=2001'], ['&limit=abc']])('rejects %s with 400', async (extra) => {
    expect((await pull('0', extra)).status).toBe(400);
  });

  it('rejects a malformed cursor or missing deviceId with 400', async () => {
    expect((await h.call(userId, `/sync/pull?cursor=abc&deviceId=${deviceId}`)).status).toBe(400);
    expect((await h.call(userId, `/sync/pull?cursor=0`)).status).toBe(400);
  });
});
