import {
  currentStreak,
  endOfStudyDay,
  goalMet,
  longestStreak,
  streakStatus,
  studyDay,
  todayWorkload,
  type StreakStatus,
} from '@anki-duo/domain';
import type { DailyActivity, DayFlagEvent, LocalStore, Settings, Stats } from './local-store';
import { introducedToday } from './session/session-machine';

export interface GamificationContext {
  store: LocalStore;
  userId: string;
  settings: Settings;
  now: Date;
}

export interface TodayResult {
  goalCrossed: boolean;
  streak: number;
  streakIncreased: boolean;
  status: StreakStatus;
}

const emptyStats: Stats = {
  totalXp: 0,
  currentStreak: 0,
  longestStreak: 0,
  lastGoalDay: null,
  cardCount: 0,
  mediaBytes: 0,
};

/**
 * Optimistic XP, review count and streak for today, written to LocalStore before the server has
 * answered. The next pull replaces these values with the server's (research R6).
 */
export async function adjustToday(
  ctx: GamificationContext,
  delta: { reviews: number; xp: number },
): Promise<TodayResult> {
  const { store, userId, settings, now } = ctx;
  const today = studyDay(now, settings.timeZone, settings.dayStartHour);
  const rows = await store.listDailyActivity();
  const existing = rows.find((r) => r.studyDay === today);
  const before = existing ? existing.goalMet : false;
  const xp = Math.max(0, (existing?.xp ?? 0) + delta.xp);
  const row: DailyActivity = {
    studyDay: today,
    reviews: Math.max(0, (existing?.reviews ?? 0) + delta.reviews),
    xp,
    goalXp: settings.dailyXpGoal,
    allAvailableDone: existing?.allAvailableDone ?? false,
    goalMet: goalMet({
      xp,
      goalXp: settings.dailyXpGoal,
      allAvailableDone: existing?.allAvailableDone ?? false,
    }),
  };
  await store.putDailyActivity([row]);

  const all = [...rows.filter((r) => r.studyDay !== today), row];
  const met = all.filter((r) => r.goalMet).map((r) => r.studyDay);
  const stats = (await store.getStats(userId)) ?? emptyStats;
  const streakBefore = stats.currentStreak;
  const streak = currentStreak(met, today);
  await store.putStats(userId, {
    ...stats,
    totalXp: Math.max(0, stats.totalXp + delta.xp),
    currentStreak: streak,
    longestStreak: longestStreak(met, today, stats.longestStreak),
    lastGoalDay: met.length ? met.toSorted().at(-1)! : null,
  });
  return {
    goalCrossed: !before && row.goalMet,
    streak,
    streakIncreased: streak > streakBefore,
    status: streakStatus(met, today),
  };
}

/**
 * When a session leaves nothing due and no new card allowed today, queue one `day_flag` so the
 * streak counts a small deck as done (FR-025). At most once per study day.
 */
export async function queueDayFlagIfDone(
  ctx: GamificationContext,
  newId: () => string,
): Promise<boolean> {
  const { store, settings, now } = ctx;
  const today = studyDay(now, settings.timeZone, settings.dayStartHour);
  const end = endOfStudyDay(today, settings.timeZone, settings.dayStartHour);
  const row = (await store.listDailyActivity()).find((r) => r.studyDay === today);
  if (!row || row.reviews === 0 || row.allAvailableDone) return false;
  if ((await store.listOutbox()).some((e) => e.type === 'day_flag' && e.studyDay === today)) {
    return false;
  }

  const decks = (await store.listDecks()).filter((d) => !d.deletedAt);
  const cards = [];
  const plans = [];
  for (const deck of decks) {
    const deckCards = (await store.listCards(deck.id)).filter((c) => !c.deletedAt);
    plans.push({
      id: deck.id,
      newCardsPerDay: deck.newCardsPerDay,
      introducedToday: introducedToday(deckCards, today, settings),
    });
    for (const c of deckCards) {
      cards.push({
        id: c.id,
        deckId: c.deckId,
        state: c.fsrs.state,
        due: new Date(c.fsrs.due),
        suspended: c.suspended,
      });
    }
  }
  if (todayWorkload(cards, plans, end) > 0) return false;

  const event: DayFlagEvent = {
    type: 'day_flag',
    id: newId(),
    studyDay: today,
    allAvailableDone: true,
  };
  await store.appendOutbox(event);
  await store.putDailyActivity([{ ...row, allAvailableDone: true, goalMet: true }]);
  // Streak may have just been met.
  await adjustToday(ctx, { reviews: 0, xp: 0 });
  return true;
}
