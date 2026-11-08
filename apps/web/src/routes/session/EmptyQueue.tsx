import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { dexieStore } from '../../client/store';
import { ChunkyButton, Icon } from '../../components/ui';

/** Nothing due and no new cards left: show when the next review is, and offer study-ahead (0 XP). */
export function EmptyQueue({ deckId, onStudyAhead }: { deckId: string; onStudyAhead: () => void }) {
  const { t, i18n } = useTranslation();
  const [next, setNext] = useState<string | null | undefined>(undefined);
  const [canAhead, setCanAhead] = useState(false);

  useEffect(() => {
    void (async () => {
      const ids =
        deckId === 'all'
          ? (await dexieStore.listDecks()).filter((d) => !d.deletedAt).map((d) => d.id)
          : [deckId];
      const cards = (await Promise.all(ids.map((id) => dexieStore.listCards(id)))).flat();
      const live = cards.filter((c) => !c.suspended && !c.deletedAt && c.fsrs.state !== 'new');
      const due = live.map((c) => c.fsrs.due).sort();
      setNext(due[0] ?? null);
      setCanAhead(live.some((c) => c.fsrs.state === 'review'));
    })();
  }, [deckId]);

  const when =
    next &&
    new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' }).format(
      new Date(next),
    );

  return (
    <section className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-5 px-4 py-12 text-center">
      {/* Celebratory medallion in primary-tint */}
      <div className="flex h-20 w-20 items-center justify-center rounded-full border-4 border-primary bg-primary-tint shadow-[0_5px_0_var(--color-primary-depth)]">
        <Icon name="check" size={38} className="text-primary-accent" />
      </div>

      <div className="space-y-2">
        <h1 className="text-2xl font-black tracking-tight text-text sm:text-3xl">
          {t('session.emptyTitle')}
        </h1>
        {next !== undefined && (
          <div className="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3.5 py-1.5 text-xs font-bold text-text-muted">
            <Icon name="timer" size={14} className="text-text-subtle" />
            <span>{when ? t('session.nextDue', { when }) : t('session.noNext')}</span>
          </div>
        )}
      </div>

      {canAhead && (
        <div className="flex flex-col items-center gap-2 pt-2">
          <ChunkyButton variant="secondary" onClick={onStudyAhead}>
            <Icon name="book-open" size={18} />
            <span>{t('session.studyAhead')}</span>
          </ChunkyButton>
          <p className="text-xs font-bold text-text-muted">{t('session.studyAheadHint')}</p>
        </div>
      )}

      <div className="pt-2">
        <Link
          className="inline-flex min-h-11 items-center gap-1.5 font-extrabold text-nav-active-text hover:underline"
          to="/"
        >
          <Icon name="arrow-right" size={16} className="rotate-180" />
          <span>{t('session.backToDecks')}</span>
        </Link>
      </div>
    </section>
  );
}
