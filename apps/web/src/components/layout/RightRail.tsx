import { useSyncExternalStore } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useLiveQuery } from 'dexie-react-hooks';
import { currentStreak, studyDay } from '@anki-duo/domain';
import { connectivity } from '../../client/connectivity';
import { useSyncStatus } from '../../client/sync-status-context';
import { dexieStore } from '../../client/store';
import { introducedToday, studyWindow } from '../../client/session/session-machine';
import { saveSettings } from '../../client/settings-save';
import { Icon } from '../ui';

export interface RailData {
  streak: number;
  totalXp: number;
  goal: number;
  todayXp: number;
  newCards: number;
  learningCards: number;
  dueCards: number;
}

const EMPTY: RailData = {
  streak: 0,
  totalXp: 0,
  goal: 20,
  todayXp: 0,
  newCards: 0,
  learningCards: 0,
  dueCards: 0,
};

/** Live numbers for the status row, daily goal and today overview. */
export function useRailData(): RailData {
  const { i18n } = useTranslation();
  const data = useLiveQuery(async (): Promise<RailData> => {
    try {
      const userId = (await dexieStore.getMeta('userId')) ?? '';
      const settings = userId ? await dexieStore.getSettings(userId) : undefined;
      const stats = userId ? await dexieStore.getStats(userId) : undefined;
      const activity = await dexieStore.listDailyActivity();
      const now = new Date();
      const timeZone = settings?.timeZone ?? 'UTC';
      const today = studyDay(now, timeZone, settings?.dayStartHour ?? 4);
      const met = activity.filter((a) => a.goalMet).map((a) => a.studyDay);
      const window = settings ? studyWindow(now, settings) : { day: today, end: now };
      const endIso = window.end.toISOString();
      const decks = (await dexieStore.listDecks()).filter((d) => !d.deletedAt);
      const live = new Set(decks.map((d) => d.id));
      const all = (await dexieStore.cards.toArray()).filter(
        (c) => !c.deletedAt && live.has(c.deckId),
      );
      const cards = all.filter((c) => !c.suspended);
      // Same numbers as the stats donut centre: new cards capped by each deck's daily limit,
      // learning and review cards only when due by the end of the study day.
      let newCards = 0;
      for (const d of decks) {
        const fresh = cards.filter((c) => c.deckId === d.id && c.fsrs.state === 'new').length;
        const used = settings
          ? introducedToday(
              all.filter((c) => c.deckId === d.id),
              window.day,
              settings,
            )
          : 0;
        newCards += Math.min(fresh, Math.max(0, d.newCardsPerDay - used));
      }
      return {
        streak: Math.max(currentStreak(met, today), stats?.currentStreak ?? 0),
        totalXp: stats?.totalXp ?? 0,
        goal: settings?.dailyXpGoal ?? 20,
        todayXp: activity.find((a) => a.studyDay === today)?.xp ?? 0,
        newCards,
        learningCards: cards.filter(
          (c) =>
            (c.fsrs.state === 'learning' || c.fsrs.state === 'relearning') && c.fsrs.due <= endIso,
        ).length,
        dueCards: cards.filter((c) => c.fsrs.state === 'review' && c.fsrs.due <= endIso).length,
      };
    } catch {
      return EMPTY;
    }
  }, [i18n.language]);
  return data ?? EMPTY;
}

function useOnline() {
  return useSyncExternalStore(
    (cb) => connectivity.subscribe(cb),
    () => connectivity.isOnline(),
    () => true,
  );
}

/** Wifi icon only (mobile top bar), colored by connectivity. */
export function SyncIcon() {
  const { t } = useTranslation();
  const online = useOnline();
  const status = useSyncStatus();
  const ok = online && status !== 'error';
  const label = ok ? t('ui.rail.online') : t('ui.rail.offline');
  return (
    <span
      role="status"
      title={label}
      aria-label={label}
      className={ok ? 'text-primary-accent' : 'text-danger'}
    >
      <Icon name={ok ? 'wifi' : 'wifi-off'} size={20} />
    </span>
  );
}

/** Language toggle, sync indicator, streak and XP (desktop right rail top row). */
export function StatusRow({ data, className = '' }: { data: RailData; className?: string }) {
  const { t, i18n } = useTranslation();
  const online = useOnline();
  const status = useSyncStatus();
  const ok = online && status !== 'error';
  const isVi = i18n.language?.startsWith('vi');
  const nextLang = isVi ? 'en' : 'vi';
  const label = ok ? t('ui.rail.online') : t('ui.rail.offline');

  async function toggleLanguage() {
    await saveSettings({ locale: nextLang });
  }

  return (
    <div className={`flex items-center justify-between gap-3 text-sm font-extrabold ${className}`}>
      <button
        type="button"
        onClick={() => void toggleLanguage()}
        aria-label={t('ui.rail.language')}
        className="flex cursor-pointer items-center gap-1.5 rounded-lg px-1 py-1 text-text-muted"
      >
        <Icon name="globe" size={20} className="text-secondary" />
        <span>{isVi ? 'VI' : 'EN'}</span>
      </button>
      <span
        title={label}
        className={`flex items-center gap-1.5 text-xs ${ok ? 'text-primary-accent' : 'text-danger'}`}
      >
        <Icon name={ok ? 'wifi' : 'wifi-off'} size={18} />
        <span>{label}</span>
      </span>
      <span className="flex items-center gap-1.5 text-orange" title={t('home.goalLabel')}>
        <Icon name="flame" size={20} />
        {data.streak}
      </span>
      <span className="flex items-center gap-1.5 text-gold-depth">
        <Icon name="zap" size={20} />
        {data.totalXp.toLocaleString(i18n.language)}
      </span>
    </div>
  );
}

const card = 'rounded-2xl border-2 border-border bg-[var(--color-card)] p-5';

export function DailyQuestCard({ data }: { data: RailData }) {
  const { t } = useTranslation();
  const pct = data.goal > 0 ? Math.min(100, (data.todayXp / data.goal) * 100) : 0;
  return (
    <div className={`${card} flex flex-col gap-3`}>
      <div className="flex items-center justify-between">
        <h3 className="text-base font-extrabold text-text">{t('ui.rail.studyGoal')}</h3>
        <Link
          to="/dashboard"
          className="text-xs font-extrabold uppercase tracking-[0.08em] text-nav-active-text"
        >
          {t('ui.rail.details')}
        </Link>
      </div>
      <div className="flex items-center gap-3">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-gold text-[var(--color-ink)] shadow-[0_4px_0_var(--color-gold-depth)]">
          <Icon name="zap" size={26} />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <span className="text-sm font-extrabold text-text">
            {data.todayXp}/{data.goal} XP
          </span>
          {/* Decorative; avoids a second role="progressbar" next to page content. */}
          <div aria-hidden="true" className="h-3 w-full overflow-hidden rounded-full bg-track">
            <div
              className="relative h-full rounded-full bg-primary transition-all duration-300 after:absolute after:inset-x-2 after:top-[2px] after:h-[3px] after:rounded-full after:bg-white/40"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border-2 border-border bg-surface text-orange shadow-[0_3px_0_var(--color-border)]">
          <Icon name="gift" size={22} />
        </div>
      </div>
    </div>
  );
}

export function TodayOverview({ data }: { data: RailData }) {
  const { t } = useTranslation();
  const rows = [
    { dot: 'bg-secondary', text: 'text-secondary', label: t('ui.rail.newLabel'), n: data.newCards },
    {
      dot: 'bg-orange',
      text: 'text-orange',
      label: t('ui.rail.learningLabel'),
      n: data.learningCards,
    },
    { dot: 'bg-danger', text: 'text-danger', label: t('ui.rail.dueLabel'), n: data.dueCards },
  ];
  return (
    <div className={`${card} flex flex-col gap-4`}>
      <h3 className="text-base font-extrabold text-text">{t('ui.rail.todayOverview')}</h3>
      <ul className="flex flex-col gap-3.5">
        {rows.map((r) => (
          <li
            key={r.label}
            className="flex items-center justify-between text-sm font-bold text-text"
          >
            <span className="flex items-center gap-3">
              <span aria-hidden="true" className={`h-3.5 w-3.5 rounded-full ${r.dot}`} />
              {r.label}
            </span>
            <span className={`text-base font-extrabold ${r.text}`}>{r.n}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Desktop right rail: status row, daily quest and today overview. */
export function RightRail({ data }: { data?: RailData }) {
  const live = useRailData();
  const d = data ?? live;
  return (
    <div className="flex flex-col gap-5">
      <StatusRow data={d} />
      <DailyQuestCard data={d} />
      <TodayOverview data={d} />
    </div>
  );
}
