/**
 * Demo data. `pnpm db:seed [--scenario=default|due25|heavy]`
 *   default  3 decks, 90 days of history
 *   due25    default + 25 cards due now in "Từ vựng N3" (queue and FR-006 checks)
 *   heavy    20,000 cards and 3 years of history (SC-010 load check)
 */
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { eq } from 'drizzle-orm';
import { hashPassword } from 'better-auth/crypto';
import {
  SCHEDULER_VERSION,
  encodeState,
  newCard,
  reviewXp,
  schedule,
  studyDay,
  type FsrsState,
  type Grade,
} from '@anki-duo/domain';
import { getDb, schema, type Db } from '../src/db/client.js';

export const DEMO_EMAIL = 'demo@anki-duo.local';
export const DEMO_PASSWORD = 'demo-password-123';
const TZ = 'Asia/Ho_Chi_Minh';
const DAY = 86_400_000;
const PARAMS = { desiredRetention: 0.9, maximumIntervalDays: 36500 };
export type Scenario = 'default' | 'due25' | 'heavy';

/** Small deterministic PRNG so seeded data is repeatable. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pickGrade = (r: number): Grade => (r < 0.08 ? 1 : r < 0.2 ? 2 : r < 0.85 ? 3 : 4);

interface DeckPlan {
  name: string;
  cards: number;
  historyDays: number;
  /** Cards that get one Good review 3 days ago, so they are due now. */
  dueNow?: number;
  /** Cards left untouched (new). */
  fresh?: number;
}

function plans(scenario: Scenario): DeckPlan[] {
  if (scenario === 'heavy')
    return [{ name: 'Heavy deck', cards: 20_000, historyDays: 365 * 3, fresh: 2000 }];
  return [
    {
      name: 'Từ vựng N3',
      cards: 60,
      historyDays: 90,
      fresh: 10,
      dueNow: scenario === 'due25' ? 25 : 0,
    },
    { name: 'English idioms', cards: 40, historyDays: 90, fresh: 5 },
    { name: 'Media sample', cards: 5, historyDays: 0, fresh: 5 },
  ];
}

const chunks = <T>(a: T[], n: number) =>
  Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));

export async function seed(db: Db, opts: { scenario?: Scenario; now?: Date } = {}) {
  const scenario = opts.scenario ?? 'default';
  const now = opts.now ?? new Date();
  const rand = rng(20260305);

  // Replace the demo learner so the seed can be re-run.
  await db.delete(schema.user).where(eq(schema.user.email, DEMO_EMAIL));
  const userId = randomUUID();
  await db
    .insert(schema.user)
    .values({ id: userId, name: 'Demo', email: DEMO_EMAIL, emailVerified: true });
  await db.insert(schema.account).values({
    accountId: userId,
    providerId: 'credential',
    userId,
    password: await hashPassword(DEMO_PASSWORD),
  });
  await db.insert(schema.learnerSettings).values({ userId, locale: 'vi', timeZone: TZ });
  await db.insert(schema.learnerStats).values({ userId });

  const logs: (typeof schema.reviewLog.$inferInsert)[] = [];
  const cardRows: (typeof schema.card.$inferInsert)[] = [];
  const decks: (typeof schema.deck.$inferInsert)[] = [];
  const dailyReviews = new Map<string, number>();

  for (const plan of plans(scenario)) {
    const deckId = randomUUID();
    const createdAt = new Date(now.getTime() - Math.max(plan.historyDays, 1) * DAY);
    decks.push({
      id: deckId,
      userId,
      name: plan.name,
      nextPosition: plan.cards,
      createdAt,
      updatedAt: createdAt,
    });

    for (let i = 0; i < plan.cards; i++) {
      const id = randomUUID();
      const front = `${plan.name} #${i + 1}`;
      let state: FsrsState = newCard(createdAt);
      const fresh = i >= plan.cards - (plan.fresh ?? 0);
      const dueNowCard = !fresh && i >= plan.cards - (plan.fresh ?? 0) - (plan.dueNow ?? 0);

      const review = (at: Date, grade: Grade) => {
        const next = schedule(state, grade, at, PARAMS);
        const day = studyDay(at, TZ, 4);
        dailyReviews.set(day, (dailyReviews.get(day) ?? 0) + 1);
        logs.push({
          id: randomUUID(),
          userId,
          cardId: id,
          deckId,
          kind: 'review',
          grade,
          reviewedAt: at,
          durationMs: 2000 + Math.floor(rand() * 6000),
          wasNew: state.state === 'new',
          wasDue: true,
          studyAhead: false,
          xp: reviewXp({ kind: 'review', studyAhead: false, revokedAt: null }),
          stateBefore: encodeState(state),
          stateAfter: encodeState(next.card),
          schedulerVersion: SCHEDULER_VERSION,
        });
        state = next.card;
      };

      if (dueNowCard) {
        review(new Date(now.getTime() - 3 * DAY), 3);
        state = { ...state, due: new Date(now.getTime() - 60_000) };
        // The log keeps the scheduler's own result; only the card is nudged to be due now.
      } else if (!fresh && plan.historyDays > 0) {
        // First review a few days after creation, then every time the card comes due, at 09:00 local.
        let at = new Date(
          createdAt.getTime() +
            Math.floor(rand() * Math.min(plan.historyDays, 30)) * DAY +
            2 * 3_600_000,
        );
        while (at.getTime() < now.getTime()) {
          review(at, pickGrade(rand()));
          const nextDue = state.due.getTime();
          const dayStart =
            Math.ceil((nextDue - 2 * 3_600_000) / DAY) * DAY +
            2 * 3_600_000 +
            Math.floor(rand() * 3_000_000);
          at = new Date(Math.max(dayStart, at.getTime() + 60_000));
        }
      }
      cardRows.push({
        id,
        userId,
        deckId,
        position: i,
        nodeIndex: Math.floor(i / 10),
        front,
        back: `Answer ${i + 1}`,
        frontNorm: front.toLowerCase(),
        tags: i % 2 ? ['odd'] : ['even'],
        state: state.state,
        due: state.due,
        stability: state.stability,
        difficulty: state.difficulty,
        learningSteps: state.learningSteps,
        reps: state.reps,
        lapses: state.lapses,
        lastReview: state.lastReview,
        createdAt,
        updatedAt: createdAt,
      });
    }
  }

  await db.insert(schema.deck).values(decks);
  for (const c of chunks(cardRows, 1000)) await db.insert(schema.card).values(c);
  // Card rows keep the final state computed above; logs go in after cards (FK).
  for (const c of chunks(logs, 1000)) await db.insert(schema.reviewLog).values(c);

  // Daily activity, XP and streaks (the API recomputes these on every push; this is the seed's copy).
  const goal = 20;
  const days = [...dailyReviews.keys()].sort();
  const activity = days.map((d) => {
    const reviews = dailyReviews.get(d)!;
    const xp = reviews * 2;
    return { userId, studyDay: d, reviews, xp, goalXp: goal, goalMet: xp >= goal };
  });
  for (const c of chunks(activity, 1000)) await db.insert(schema.dailyActivity).values(c);

  const today = studyDay(now, TZ, 4);
  const met = new Set(activity.filter((a) => a.goalMet).map((a) => a.studyDay));
  const dayBefore = (d: string) =>
    new Date(Date.parse(`${d}T00:00:00Z`) - DAY).toISOString().slice(0, 10);
  let current = 0;
  for (let d = met.has(today) ? today : dayBefore(today); met.has(d); d = dayBefore(d)) current++;
  let longest = 0;
  let run = 0;
  for (const d of days) {
    run = met.has(d) && met.has(dayBefore(d)) ? run + 1 : met.has(d) ? 1 : 0;
    longest = Math.max(longest, run);
  }
  await db
    .update(schema.learnerStats)
    .set({
      totalXp: activity.reduce((n, a) => n + a.xp, 0),
      currentStreak: current,
      longestStreak: Math.max(longest, current),
      lastGoalDay: [...met].sort().at(-1) ?? null,
      cardCount: cardRows.length,
    })
    .where(eq(schema.learnerStats.userId, userId));

  return { userId, cards: cardRows.length, logs: logs.length, days: days.length };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const envFile = new URL('../.env', import.meta.url);
  if (existsSync(envFile)) {
    process.loadEnvFile(envFile);
  }
  const arg = process.argv.find((a) => a.startsWith('--scenario='))?.split('=')[1] as
    Scenario | undefined;
  const scenario = arg ?? 'default';
  if (!['default', 'due25', 'heavy'].includes(scenario))
    throw new Error(`unknown scenario ${scenario}`);
  seed(getDb(), { scenario }).then(
    (r) => {
      console.log(`seeded ${scenario}: ${r.cards} cards, ${r.logs} reviews over ${r.days} days`);
      console.log(`sign in as ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
      process.exit(0);
    },
    (e) => {
      console.error(e);
      process.exit(1);
    },
  );
}
