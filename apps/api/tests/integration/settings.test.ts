import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { schema } from '../../src/db/client.js';
import { createTestDb, type TestDb } from '../helpers/db.js';
import { appAs } from '../helpers/session.js';

let t: TestDb;
let h: ReturnType<typeof appAs>;
let userId: string;
beforeEach(async () => {
  t = await createTestDb();
  h = appAs(t.db);
  userId = (await h.newUser()).id;
});
afterEach(() => t.close());

const patch = (json: unknown) => h.call(userId, '/me/settings', { method: 'PATCH', json });

describe('PATCH /api/v1/me/settings', () => {
  it('requires a signed-in user', async () => {
    expect(
      (await h.call(null, '/me/settings', { method: 'PATCH', json: { sessionSize: 10 } })).status,
    ).toBe(401);
  });

  it('updates fields and returns the full Settings', async () => {
    const res = await patch({
      sessionSize: 30,
      dailyXpGoal: 50,
      desiredRetention: 0.85,
      motion: 'reduced',
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      locale: 'en',
      timeZone: 'UTC',
      dayStartHour: 4,
      desiredRetention: 0.85,
      maximumIntervalDays: 36500,
      dailyXpGoal: 50,
      sessionSize: 30,
      soundEnabled: true,
      motion: 'reduced',
      autoGrade: false,
    });
    const [row] = await t.db
      .select()
      .from(schema.learnerSettings)
      .where(eq(schema.learnerSettings.userId, userId));
    expect(row).toMatchObject({ sessionSize: 30, dailyXpGoal: 50, desiredRetention: '0.85' });
  });

  it('accepts the boundaries', async () => {
    for (const body of [
      { desiredRetention: 0.7 },
      { desiredRetention: 0.97 },
      { maximumIntervalDays: 1 },
      { maximumIntervalDays: 36500 },
      { dayStartHour: 0 },
      { dayStartHour: 23 },
      { sessionSize: 5 },
      { sessionSize: 50 },
    ]) {
      expect((await patch(body)).status, JSON.stringify(body)).toBe(200);
    }
  });

  it.each([
    [{ desiredRetention: 0.69 }],
    [{ desiredRetention: 0.98 }],
    [{ maximumIntervalDays: 0 }],
    [{ maximumIntervalDays: 36501 }],
    [{ maximumIntervalDays: 10.5 }],
    [{ dayStartHour: -1 }],
    [{ dayStartHour: 24 }],
    [{ dailyXpGoal: 15 }],
    [{ sessionSize: 4 }],
    [{ sessionSize: 51 }],
    [{ locale: 'fr' }],
    [{ motion: 'wild' }],
    [{ timeZone: 'Mars/Olympus' }],
    [{}],
  ])('rejects %j with 422 validation_failed and changes nothing', async (body) => {
    const res = await patch(body);
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ code: 'validation_failed' });
    const [row] = await t.db
      .select()
      .from(schema.learnerSettings)
      .where(eq(schema.learnerSettings.userId, userId));
    expect(row).toMatchObject({ sessionSize: 20, dailyXpGoal: 20, desiredRetention: '0.90' });
  });

  it('only changes the caller', async () => {
    const other = await h.newUser();
    await patch({ sessionSize: 45 });
    const [row] = await t.db
      .select()
      .from(schema.learnerSettings)
      .where(eq(schema.learnerSettings.userId, other.id));
    expect(row!.sessionSize).toBe(20);
  });

  it('does not rewrite stored card state (FR-004)', async () => {
    const { createDeck, createCard } = await import('../helpers/db.js');
    const deck = await createDeck(t.db, userId);
    const card = await createCard(t.db, userId, deck.id, {
      state: 'review',
      stability: 12,
      difficulty: 5,
    });
    await patch({ desiredRetention: 0.8, maximumIntervalDays: 30 });
    const [after] = await t.db.select().from(schema.card).where(eq(schema.card.id, card.id));
    expect(after).toMatchObject({ stability: 12, difficulty: 5, state: 'review' });
  });
});

describe('autoGrade', () => {
  it('defaults to false and can be set', async () => {
    expect(((await (await patch({ sessionSize: 10 })).json()) as any).autoGrade).toBe(false);
    const res = await patch({ autoGrade: true });
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).autoGrade).toBe(true);
    const [row] = await t.db
      .select()
      .from(schema.learnerSettings)
      .where(eq(schema.learnerSettings.userId, userId));
    expect(row!.autoGrade).toBe(true);
  });
});
