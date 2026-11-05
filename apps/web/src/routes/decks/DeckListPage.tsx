import { useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { useTranslation } from 'react-i18next';
import { newCardAllowance } from '@anki-duo/domain';
import { introducedToday, studyWindow } from '../../client/session/session-machine';
import { dexieStore } from '../../client/store';
import type { Deck } from '../../client/local-store';
import { content } from '../../client/runtime';
import { useOnlineOnly } from '../../client/online-only';
import { ChunkyButton } from '../../components/ui';
import { notify } from '../../client/notify';
import { describeApiError } from '../../lib/api-error';
import { DeckSettingsDialog } from './DeckSettingsDialog';

interface Row {
  deck: Deck;
  cardCount: number;
  due: number;
  fresh: number;
}

/** Decks with the number of cards due and new cards still allowed today, all from LocalStore. */
export function DeckListPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const net = useOnlineOnly();
  const [editing, setEditing] = useState<Deck | null | undefined>(undefined); // undefined = closed
  const fileInput = useRef<HTMLInputElement>(null);

  // Live: a deck created, renamed or deleted (or pulled from another device) shows up at once.
  const rows = useLiveQuery(async (): Promise<Row[]> => {
    const userId = (await dexieStore.getMeta('userId')) ?? '';
    const settings = await dexieStore.getSettings(userId);
    const win = settings ? studyWindow(new Date(), settings) : null;
    const decks = (await dexieStore.listDecks()).filter((d) => !d.deletedAt);
    const out: Row[] = [];
    for (const deck of decks.sort((a, b) => a.name.localeCompare(b.name))) {
      const all = await dexieStore.listCards(deck.id);
      const cards = all.filter((c) => !c.suspended);
      const end = win ? win.end.toISOString() : new Date().toISOString();
      const due = cards.filter((c) => c.fsrs.state !== 'new' && c.fsrs.due <= end).length;
      const newCards = cards.filter((c) => c.fsrs.state === 'new').length;
      const intro = settings && win ? introducedToday(cards, win.day, settings) : 0;
      const fresh = Math.min(
        newCards,
        newCardAllowance({ sessionSize: 0, newCardsPerDay: deck.newCardsPerDay }, intro),
      );
      out.push({ deck, cardCount: all.length, due, fresh });
    }
    return out;
  }, []);

  const restore = async (file: File) => {
    try {
      const parsed: unknown = JSON.parse(await file.text());
      await content.restoreDeck(parsed);
      notify.show(t('decks.restoreDone'));
    } catch (e) {
      notify.show(e instanceof SyntaxError ? t('decks.restoreFailed') : describeApiError(t, e));
    }
  };

  return (
    <section className="py-4">
      <h1 className="mb-4 text-2xl font-bold">{t('decks.title')}</h1>
      <div className="mb-4 flex flex-wrap gap-2">
        <ChunkyButton onClick={() => setEditing(null)} {...net.buttonProps}>
          {t('decks.new')}
        </ChunkyButton>
        <ChunkyButton
          variant="neutral"
          onClick={() => fileInput.current?.click()}
          {...net.buttonProps}
        >
          {t('decks.restore')}
        </ChunkyButton>
        <input
          ref={fileInput}
          type="file"
          accept=".json,application/json"
          hidden
          data-testid="restore-input"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) void restore(f);
          }}
        />
      </div>
      {net.message && (
        <p role="status" className="mb-3 text-text-muted">
          {net.message}
        </p>
      )}
      {rows === undefined ? (
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
              <div className="flex flex-wrap justify-end gap-2">
                <ChunkyButton onClick={() => navigate(`/session/${deck.id}`)}>
                  {t('decks.review')}
                </ChunkyButton>
                <ChunkyButton variant="neutral" onClick={() => navigate(`/decks/${deck.id}/cards`)}>
                  {t('decks.cards')}
                </ChunkyButton>
                <ChunkyButton
                  variant="neutral"
                  onClick={() => navigate(`/decks/${deck.id}/import`)}
                >
                  {t('decks.import')}
                </ChunkyButton>
                <ChunkyButton variant="neutral" onClick={() => setEditing(deck)}>
                  {t('decks.settings')}
                </ChunkyButton>
              </div>
            </li>
          ))}
        </ul>
      )}
      <DeckSettingsDialog
        open={editing !== undefined}
        deck={editing ?? null}
        cardCount={editing ? (rows?.find((r) => r.deck.id === editing.id)?.cardCount ?? 0) : 0}
        onClose={() => setEditing(undefined)}
      />
    </section>
  );
}
