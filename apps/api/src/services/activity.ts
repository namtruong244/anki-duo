import { and, eq, sql } from 'drizzle-orm';
import { currentStreak, goalMet, longestStreak, studyDay } from '@anki-duo/domain';
import { schema, type Db } from '../db/client.js';

/** The study day an instant falls in, as SQL, matching `studyDay()` in the domain. */
const studyDaySql = (col: unknown, timeZone: string, dayStartHour: number) =>
  sql`((${col} at time zone ${timeZone}) - make_interval(hours => ${dayStartHour}))::date`;

/**
 * Re-derives `daily_activity` for the given study days from the review logs and sessions, then
 * refreshes the learner's totals and streaks. Everything is recomputed from the source rows, so
 * out-of-order pushes and revokes cannot leave it wrong (data-model: DailyActivity, LearnerStats).
 */
export async function recomputeActivity(
  tx: Db,
  userId: string,
  days: Iterable<string>,
  now: Date,
): Promise<void> {
  const wanted = [...new Set(days)];
  if (!wanted.length) return;

  const [settings] = await tx
    .select()
    .from(schema.learnerSettings)
    .where(eq(schema.learnerSettings.userId, userId));
  const tz = settings?.timeZone ?? 'UTC';
  const dayStart = settings?.dayStartHour ?? 4;
  const goalNow = settings?.dailyXpGoal ?? 20;
  const today = studyDay(now, tz, dayStart);
  const logDay = studyDaySql(schema.reviewLog.reviewedAt, tz, dayStart);

  for (const d of wanted) {
    const [logs] = await tx
      .select({
        reviews: sql<number>`count(*) filter (where ${schema.reviewLog.kind} = 'review')::int`,
        xp: sql<number>`coalesce(sum(${schema.reviewLog.xp}), 0)::int`,
      })
      .from(schema.reviewLog)
      .where(
        and(
          eq(schema.reviewLog.userId, userId),
          sql`${schema.reviewLog.revokedAt} is null`,
          sql`${logDay} = ${d}`,
        ),
      );
    const [sessions] = await tx
      .select({ bonus: sql<number>`coalesce(sum(${schema.studySession.bonusXp}), 0)::int` })
      .from(schema.studySession)
      .where(and(eq(schema.studySession.userId, userId), eq(schema.studySession.studyDay, d)));

    const [existing] = await tx
      .select()
      .from(schema.dailyActivity)
      .where(and(eq(schema.dailyActivity.userId, userId), eq(schema.dailyActivity.studyDay, d)));
    // Past days keep the goal they were played under; today follows the current setting.
    const goalXp = d === today || !existing ? goalNow : existing.goalXp;
    const allAvailableDone = existing?.allAvailableDone ?? false;
    const xp = (logs?.xp ?? 0) + (sessions?.bonus ?? 0);
    const values = {
      reviews: logs?.reviews ?? 0,
      xp,
      goalXp,
      allAvailableDone,
      goalMet: goalMet({ xp, goalXp, allAvailableDone }),
    };
    await tx
      .insert(schema.dailyActivity)
      .values({ userId, studyDay: d, ...values })
      .onConflictDoUpdate({
        target: [schema.dailyActivity.userId, schema.dailyActivity.studyDay],
        set: values,
      });
  }

  const all = await tx
    .select()
    .from(schema.dailyActivity)
    .where(eq(schema.dailyActivity.userId, userId));
  const metDays = all.filter((a) => a.goalMet).map((a) => a.studyDay);
  const [stats] = await tx
    .select()
    .from(schema.learnerStats)
    .where(eq(schema.learnerStats.userId, userId));
  await tx
    .update(schema.learnerStats)
    .set({
      totalXp: all.reduce((n, a) => n + a.xp, 0),
      currentStreak: currentStreak(metDays, today),
      longestStreak: longestStreak(metDays, today, stats?.longestStreak ?? 0),
      lastGoalDay: metDays.length ? metDays.toSorted().at(-1)! : null,
    })
    .where(eq(schema.learnerStats.userId, userId));
}

/** The study day of an instant for this learner. */
export async function studyDayFor(tx: Db, userId: string, at: Date): Promise<string> {
  const [s] = await tx
    .select()
    .from(schema.learnerSettings)
    .where(eq(schema.learnerSettings.userId, userId));
  return studyDay(at, s?.timeZone ?? 'UTC', s?.dayStartHour ?? 4);
}
