import { useState, type ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useTranslation } from 'react-i18next';
import { donutCounts, heatmapBuckets, todayWorkload } from '@anki-duo/domain';
import { introducedToday, studyWindow } from '../../client/session/session-machine';
import { dexieStore } from '../../client/store';
import { Icon, type IconName } from '../../components/ui';
import { DonutRing } from '../../components/charts/DonutRing';
import { Heatmap } from '../../components/charts/Heatmap';

/**
 * Stats page (frames "Thống kê" / "Mobile stats"): deck filter chips, three record cards,
 * card-status donut and the 12-month study calendar.
 * The deck filter only narrows the donut: daily activity is stored per day, not per deck.
 */
export function DashboardPage() {
  const { t, i18n } = useTranslation();
  const [deckId, setDeckId] = useState('all');

  const data = useLiveQuery(async () => {
    const userId = (await dexieStore.getMeta('userId')) ?? '';
    const settings = await dexieStore.getSettings(userId);
    const stats = await dexieStore.getStats(userId);
    const activity = await dexieStore.listDailyActivity();
    const decks = (await dexieStore.listDecks()).filter((d) => !d.deletedAt);
    const cards = [];
    for (const d of decks) {
      cards.push(...(await dexieStore.listCards(d.id)).filter((c) => !c.deletedAt));
    }
    return { settings, stats, activity, decks, cards };
  }, [i18n.language]);

  if (!data) {
    return (
      <p role="status" className="py-4 font-bold text-text-muted">
        {t('common.loading')}
      </p>
    );
  }

  const { settings, stats, activity, decks, cards } = data;
  const win = settings
    ? studyWindow(new Date(), settings)
    : { day: new Date().toISOString().slice(0, 10), end: new Date() };

  const chosen = deckId === 'all' ? cards : cards.filter((c) => c.deckId === deckId);
  const statCards = chosen.map((c) => ({
    id: c.id,
    deckId: c.deckId,
    state: c.fsrs.state,
    due: new Date(c.fsrs.due),
    suspended: c.suspended,
  }));
  const deckInfo = decks
    .filter((d) => deckId === 'all' || d.id === deckId)
    .map((d) => ({
      id: d.id,
      newCardsPerDay: d.newCardsPerDay,
      introducedToday: settings
        ? introducedToday(
            cards.filter((c) => c.deckId === d.id),
            win.day,
            settings,
          )
        : 0,
    }));
  const counts = donutCounts(statCards, win.end);
  const centre = todayWorkload(statCards, deckInfo, win.end);
  const cells = heatmapBuckets(activity, win.day);
  const daysStudied = activity.filter((a) => a.reviews > 0).length;

  return (
    <section className="flex flex-col gap-4 py-4">
      <h1 className="text-3xl font-black tracking-tight text-text">{t('dashboard.title')}</h1>

      {/* Deck filter chips */}
      <div
        role="group"
        aria-label={t('dashboard.deckFilter')}
        className="-mx-1 flex gap-2.5 overflow-x-auto px-1 pb-2"
      >
        <DeckChip active={deckId === 'all'} onClick={() => setDeckId('all')}>
          <span className="hidden sm:inline">{t('dashboard.allDecks')}</span>
          <span className="sm:hidden">{t('dashboard.allDecksShort')}</span>
        </DeckChip>
        {decks.map((d) => (
          <DeckChip key={d.id} active={deckId === d.id} onClick={() => setDeckId(d.id)}>
            {d.name}
          </DeckChip>
        ))}
      </div>

      {/* Record cards */}
      <div className="grid grid-cols-3 gap-2.5 sm:gap-3">
        <RecordCard
          icon="flame"
          tone="orange"
          label={t('dashboard.currentStreak')}
          shortLabel={t('dashboard.currentStreakShort')}
          value={String(stats?.currentStreak ?? 0)}
          hint={t('dashboard.currentStreakHint')}
        />
        <RecordCard
          icon="trophy"
          tone="gold"
          label={t('dashboard.longestStreak')}
          shortLabel={t('dashboard.longestStreakShort')}
          value={String(stats?.longestStreak ?? 0)}
          hint={t('dashboard.longestHint')}
        />
        <RecordCard
          icon="zap"
          tone="gold"
          label={t('dashboard.totalXp')}
          shortLabel={t('dashboard.totalXp')}
          value={(stats?.totalXp ?? 0).toLocaleString(i18n.language)}
          hint={t('dashboard.totalXpHint')}
        />
      </div>

      {/* Card status donut */}
      <div className="rounded-[var(--radius-card)] border-2 border-border bg-card p-5">
        <h2 className="mb-4 text-base font-black text-text">{t('dashboard.cardStatus')}</h2>
        <DonutRing counts={counts} centre={centre} />
      </div>

      {/* 12-month calendar */}
      <div className="rounded-[var(--radius-card)] border-2 border-border bg-card p-5">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-base font-black text-text">{t('dashboard.heatmapTitle12')}</h2>
          <span className="text-xs font-bold text-text-subtle">
            <span className="hidden sm:inline">
              {t('dashboard.daysStudied', { n: daysStudied })}
            </span>
            <span className="sm:hidden">{t('dashboard.swipeHint')}</span>
          </span>
        </div>
        <Heatmap cells={cells} />
      </div>
    </section>
  );
}

function DeckChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`min-h-9 shrink-0 cursor-pointer whitespace-nowrap rounded-xl border-2 px-3 text-xs font-extrabold text-nav-active-text transition-colors focus-visible:outline-3 focus-visible:outline-focus ${
        active
          ? 'border-nav-active-border bg-nav-active-bg shadow-[0_3px_0_var(--color-nav-active-border)]'
          : 'border-border bg-card shadow-[0_3px_0_var(--color-border)] hover:bg-surface'
      }`}
    >
      {children}
    </button>
  );
}

function RecordCard({
  icon,
  tone,
  label,
  shortLabel,
  value,
  hint,
}: {
  icon: IconName;
  tone: 'orange' | 'gold';
  label: string;
  shortLabel: string;
  value: string;
  hint: string;
}) {
  const border = tone === 'orange' ? 'border-orange' : 'border-gold';
  const text = tone === 'orange' ? 'text-orange' : 'text-gold-depth';
  return (
    <div
      className={`flex min-w-0 flex-col gap-1.5 rounded-[var(--radius-card)] border-2 bg-card p-3 sm:p-4 ${border}`}
    >
      <p
        className={`flex min-w-0 items-center gap-1.5 text-[10px] font-black uppercase tracking-wider sm:text-xs ${text}`}
      >
        <Icon name={icon} size={22} className="shrink-0" />
        <span className={`truncate ${shortLabel === label ? '' : 'hidden sm:inline'}`}>
          {label}
        </span>
        {shortLabel !== label && <span className="truncate sm:hidden">{shortLabel}</span>}
      </p>
      <p className="text-2xl font-black tabular-nums tracking-tight text-text sm:text-3xl">
        {value}
      </p>
      <p className="hidden text-xs font-bold text-text-muted sm:block">{hint}</p>
    </div>
  );
}
