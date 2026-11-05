import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useTranslation } from 'react-i18next';
import { donutCounts, heatmapBuckets, todayWorkload } from '@anki-duo/domain';
import { introducedToday, studyWindow } from '../../client/session/session-machine';
import { dexieStore } from '../../client/store';
import { DonutRing } from '../../components/charts/DonutRing';
import { Heatmap } from '../../components/charts/Heatmap';

/** Progress dashboard. Every figure is computed from LocalStore, so it works offline. */
export function DashboardPage() {
  const { t } = useTranslation();
  const [deckId, setDeckId] = useState('all');

  const data = useLiveQuery(async () => {
    const userId = (await dexieStore.getMeta('userId')) ?? '';
    const settings = await dexieStore.getSettings(userId);
    const stats = await dexieStore.getStats(userId);
    const activity = await dexieStore.listDailyActivity();
    const decks = (await dexieStore.listDecks()).filter((d) => !d.deletedAt);
    const cards = [];
    for (const d of decks)
      cards.push(...(await dexieStore.listCards(d.id)).filter((c) => !c.deletedAt));
    return { settings, stats, activity, decks, cards };
  }, []);

  if (!data)
    return (
      <p role="status" className="py-4">
        {t('common.loading')}
      </p>
    );

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

  return (
    <section className="flex flex-col gap-6 py-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">{t('dashboard.title')}</h1>
        <label className="flex items-center gap-2">
          <span className="text-sm">{t('dashboard.deckFilter')}</span>
          <select
            className="min-h-11 rounded border border-border bg-surface px-2"
            value={deckId}
            onChange={(e) => setDeckId(e.target.value)}
          >
            <option value="all">{t('dashboard.allDecks')}</option>
            {decks.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <dl className="grid grid-cols-3 gap-3">
        <Stat
          label={t('dashboard.currentStreak')}
          value={t('dashboard.days', { n: stats?.currentStreak ?? 0 })}
        />
        <Stat
          label={t('dashboard.longestStreak')}
          value={t('dashboard.days', { n: stats?.longestStreak ?? 0 })}
        />
        <Stat label={t('dashboard.totalXp')} value={String(stats?.totalXp ?? 0)} />
      </dl>

      <div className="rounded-[var(--radius-card)] border border-border bg-surface p-4">
        <DonutRing counts={counts} centre={centre} />
      </div>

      <div className="rounded-[var(--radius-card)] border border-border bg-surface p-4">
        <h2 className="mb-2 font-bold">{t('dashboard.heatmap')}</h2>
        <Heatmap cells={cells} />
      </div>
    </section>
  );
}

const Stat = ({ label, value }: { label: string; value: string }) => (
  <div className="rounded-[var(--radius-card)] bg-surface p-3">
    <dt className="text-sm text-text-muted">{label}</dt>
    <dd className="text-xl font-bold">{value}</dd>
  </div>
);
