import { Link } from 'react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { useTranslation } from 'react-i18next';
import { currentStreak, streakStatus, studyDay } from '@anki-duo/domain';
import { newCardAllowance } from '@anki-duo/domain';
import { dexieStore } from '../../client/store';
import { introducedToday, studyWindow } from '../../client/session/session-machine';
import { StreakFlame } from '../../components/gamification/StreakFlame';
import { ProgressBar } from '../../components/ui';

interface Home {
  streak: number;
  status: 'met' | 'at_risk' | 'broken';
  xp: number;
  goal: number;
  decks: { id: string; name: string; due: number; fresh: number }[];
}

/** Streak, today's XP against the goal, cards due and the deck list, all from LocalStore (FR-026). */
export function HomePage() {
  const { t } = useTranslation();
  const home = useLiveQuery(async (): Promise<Home | null> => {
    const userId = (await dexieStore.getMeta('userId')) ?? '';
    const settings = await dexieStore.getSettings(userId);
    if (!settings) return null;
    const now = new Date();
    const win = studyWindow(now, settings);
    const today = studyDay(now, settings.timeZone, settings.dayStartHour);
    const activity = await dexieStore.listDailyActivity();
    const met = activity.filter((a) => a.goalMet).map((a) => a.studyDay);
    const stats = await dexieStore.getStats(userId);
    const decks: Home['decks'] = [];
    for (const deck of (await dexieStore.listDecks()).filter((d) => !d.deletedAt)) {
      const cards = (await dexieStore.listCards(deck.id)).filter(
        (c) => !c.deletedAt && !c.suspended,
      );
      const end = win.end.toISOString();
      const due = cards.filter((c) => c.fsrs.state !== 'new' && c.fsrs.due <= end).length;
      const newCards = cards.filter((c) => c.fsrs.state === 'new').length;
      const fresh = Math.min(
        newCards,
        newCardAllowance(
          { sessionSize: 0, newCardsPerDay: deck.newCardsPerDay },
          introducedToday(cards, win.day, settings),
        ),
      );
      decks.push({ id: deck.id, name: deck.name, due, fresh });
    }
    decks.sort((a, b) => a.name.localeCompare(b.name));
    const status = streakStatus(met, today);
    return {
      // The stored value is the server's; the live one follows the days we hold, so it never lags.
      streak: Math.max(
        currentStreak(met, today),
        status === 'broken' ? 0 : (stats?.currentStreak ?? 0),
      ),
      status,
      xp: activity.find((a) => a.studyDay === today)?.xp ?? 0,
      goal: settings.dailyXpGoal,
      decks,
    };
  }, []);

  if (!home) {
    return (
      <p role="status" className="py-4">
        {t('common.loading')}
      </p>
    );
  }
  const totalDue = home.decks.reduce((n, d) => n + d.due + d.fresh, 0);
  const first = home.decks.find((d) => d.due + d.fresh > 0);
  return (
    <section className="flex flex-col gap-4 py-4">
      <h1 className="text-2xl font-bold">{t('home.title')}</h1>
      <StreakFlame count={home.streak} status={home.status} />
      <div className="flex flex-col gap-2 rounded-[var(--radius-card)] border border-border bg-surface p-4">
        <div className="flex justify-between font-semibold">
          <span>{t('home.goalLabel')}</span>
          <span>{t('home.xpToday', { xp: home.xp, goal: home.goal })}</span>
        </div>
        <ProgressBar
          value={Math.min(home.xp, home.goal)}
          max={home.goal}
          label={t('home.goalLabel')}
        />
      </div>
      <div className="flex items-center justify-between gap-3 rounded-[var(--radius-card)] border border-border bg-surface p-4">
        <p className="text-lg font-bold">
          {totalDue > 0 ? t('home.due', { n: totalDue }) : t('home.nothingDue')}
        </p>
        {first && (
          <Link
            to={`/session/${first.id}`}
            className="inline-flex min-h-11 items-center rounded-[var(--radius-button)] bg-primary px-5 font-bold text-on-primary"
          >
            {t('home.start')}
          </Link>
        )}
      </div>
      <h2 className="text-xl font-bold">{t('home.decks')}</h2>
      {home.decks.length === 0 ? (
        <p>{t('home.noDecks')}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {home.decks.map((d) => (
            <li key={d.id}>
              <Link
                to={`/session/${d.id}`}
                className="flex min-h-11 items-center justify-between rounded-[var(--radius-card)] border border-border bg-surface p-3"
              >
                <span className="font-semibold">{d.name}</span>
                <span className="text-sm text-text-muted">
                  {t('home.deckDue', { n: d.due + d.fresh })}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
