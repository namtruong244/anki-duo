import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { newCardAllowance } from '@anki-duo/domain';
import { introducedToday, studyWindow } from '../../client/session/session-machine';
import { dexieStore } from '../../client/store';
import type { Deck } from '../../client/local-store';
import { ChunkyButton } from '../../components/ui';

interface Row {
  deck: Deck;
  due: number;
  fresh: number;
}

/** Decks with the number of cards due and new cards still allowed today, all from LocalStore. */
export function DeckListPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [rows, setRows] = useState<Row[] | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const userId = (await dexieStore.getMeta('userId')) ?? '';
      const settings = await dexieStore.getSettings(userId);
      const win = settings ? studyWindow(new Date(), settings) : null;
      const decks = (await dexieStore.listDecks()).filter((d) => !d.deletedAt);
      const out: Row[] = [];
      for (const deck of decks.sort((a, b) => a.name.localeCompare(b.name))) {
        const cards = (await dexieStore.listCards(deck.id)).filter((c) => !c.suspended);
        const end = win ? win.end.toISOString() : new Date().toISOString();
        const due = cards.filter((c) => c.fsrs.state !== 'new' && c.fsrs.due <= end).length;
        const newCards = cards.filter((c) => c.fsrs.state === 'new').length;
        const intro = settings && win ? introducedToday(cards, win.day, settings) : 0;
        const fresh = Math.min(
          newCards,
          newCardAllowance({ sessionSize: 0, newCardsPerDay: deck.newCardsPerDay }, intro),
        );
        out.push({ deck, due, fresh });
      }
      if (alive) setRows(out);
    })();
    return () => {
      alive = false;
    };
  }, []);

  return (
    <section className="py-4">
      <h1 className="mb-4 text-2xl font-bold">{t('decks.title')}</h1>
      {rows === null ? (
        <p role="status">{t('common.loading')}</p>
      ) : rows.length === 0 ? (
        <p>{t('decks.empty')}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {rows.map(({ deck, due, fresh }) => (
            <li
              key={deck.id}
              className="flex items-center justify-between gap-3 rounded-[var(--radius-card)] border border-border bg-surface p-4"
            >
              <div>
                <h2 className="font-bold">{deck.name}</h2>
                <p className="text-sm text-text-muted">
                  {due + fresh === 0
                    ? t('decks.nothingToday')
                    : `${t('decks.due', { n: due })} · ${t('decks.new', { n: fresh })}`}
                </p>
              </div>
              <ChunkyButton onClick={() => navigate(`/session/${deck.id}`)}>
                {t('decks.review')}
              </ChunkyButton>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
