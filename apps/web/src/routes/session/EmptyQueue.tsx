import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { dexieStore } from '../../client/store';
import { ChunkyButton } from '../../components/ui';

/** Nothing due and no new cards left: show when the next review is, and offer study-ahead (0 XP). */
export function EmptyQueue({ deckId, onStudyAhead }: { deckId: string; onStudyAhead: () => void }) {
  const { t, i18n } = useTranslation();
  const [next, setNext] = useState<string | null | undefined>(undefined);
  const [canAhead, setCanAhead] = useState(false);

  useEffect(() => {
    void dexieStore.listCards(deckId).then((cards) => {
      const live = cards.filter((c) => !c.suspended && c.fsrs.state !== 'new');
      const due = live.map((c) => c.fsrs.due).sort();
      setNext(due[0] ?? null);
      setCanAhead(live.some((c) => c.fsrs.state === 'review'));
    });
  }, [deckId]);

  const when =
    next &&
    new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' }).format(
      new Date(next),
    );

  return (
    <section className="flex flex-col items-center gap-4 py-10 text-center">
      <h1 className="text-2xl font-bold">{t('session.emptyTitle')}</h1>
      {next !== undefined && <p>{when ? t('session.nextDue', { when }) : t('session.noNext')}</p>}
      {canAhead && (
        <>
          <ChunkyButton variant="secondary" onClick={onStudyAhead}>
            {t('session.studyAhead')}
          </ChunkyButton>
          <p className="text-sm text-text-muted">{t('session.studyAheadHint')}</p>
        </>
      )}
      <Link className="underline" to="/decks">
        {t('session.backToDecks')}
      </Link>
    </section>
  );
}
