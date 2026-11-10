import { useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { useTranslation } from 'react-i18next';
import { newCardAllowance } from '@anki-duo/domain';
import { dexieStore } from '../../client/store';
import type { Deck } from '../../client/local-store';
import { content } from '../../client/runtime';
import { notify } from '../../client/notify';
import { useOnlineOnly } from '../../client/online-only';
import { introducedToday, studyWindow } from '../../client/session/session-machine';
import { describeApiError } from '../../lib/api-error';
import { DeckBanner } from '../../components/decks/DeckBanner';
import { ChunkyButton, Icon } from '../../components/ui';
import { DeckSettingsDialog } from '../decks/DeckSettingsDialog';

interface HomeDeck {
  deck: Deck;
  cardCount: number;
  due: number;
  fresh: number;
  masteredPct: number;
}

/** Deck hub: today's review card, then every deck with its study, cards, import and settings. */
export function HomePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const net = useOnlineOnly();
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<Deck | null | undefined>(undefined); // undefined = closed
  const fileInput = useRef<HTMLInputElement>(null);

  const home = useLiveQuery(async (): Promise<HomeDeck[] | null> => {
    const userId = (await dexieStore.getMeta('userId')) ?? '';
    const settings = await dexieStore.getSettings(userId);
    if (!settings) return null;
    const win = studyWindow(new Date(), settings);
    const decks: HomeDeck[] = [];

    for (const deck of (await dexieStore.listDecks()).filter((d) => !d.deletedAt)) {
      const all = await dexieStore.listCards(deck.id);
      const cards = all.filter((c) => !c.deletedAt && !c.suspended);
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
      const mastered = cards.filter((c) => c.fsrs.state === 'review').length;
      decks.push({
        deck,
        cardCount: all.filter((c) => !c.deletedAt).length,
        due,
        fresh,
        masteredPct: cards.length > 0 ? Math.round((mastered / cards.length) * 100) : 0,
      });
    }
    return decks.sort((x, y) => y.deck.updatedAt.localeCompare(x.deck.updatedAt));
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

  if (!home) {
    return (
      <p role="status" className="py-4">
        {t('common.loading')}
      </p>
    );
  }

  const totalDue = home.reduce((n, d) => n + d.due + d.fresh, 0);
  const first = home.find((d) => d.due + d.fresh > 0);
  const estimate = Math.max(1, Math.round(totalDue / 3.3));

  const importCsv = () => {
    const target = first ?? home[0];
    if (target) navigate(`/decks/${target.deck.id}/import`);
    else setEditing(null);
  };

  const smallAction =
    'inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg px-2 text-xs font-extrabold uppercase tracking-[0.06em] text-text-muted transition-[transform,background-color,color] duration-[var(--duration-fast)] hover:bg-surface hover:text-text enabled:active:scale-95 disabled:cursor-not-allowed disabled:opacity-50';
  const iconAction =
    'inline-flex size-9 cursor-pointer items-center justify-center rounded-lg text-text-muted transition-[transform,background-color,color] duration-[var(--duration-fast)] hover:bg-surface hover:text-text enabled:active:scale-95 disabled:cursor-not-allowed disabled:opacity-50';

  const q = query.trim().toLocaleLowerCase();
  const shown = q ? home.filter((d) => d.deck.name.toLocaleLowerCase().includes(q)) : home;
  const searchable = home.length > 5;

  return (
    <section className="flex flex-col gap-4 py-2">
      <div className="flex items-center justify-between gap-3">
        <h1 className="min-w-0 text-2xl font-black tracking-tight text-text">{t('home.decks')}</h1>
        <div className="flex shrink-0 items-center gap-2">
          <ChunkyButton variant="outline" size="sm" onClick={importCsv} {...net.buttonProps}>
            {t('ui.hub.importCsv')}
          </ChunkyButton>
          <ChunkyButton size="sm" onClick={() => setEditing(null)} {...net.buttonProps}>
            <span aria-hidden="true">+</span>
            <span>{t('decks.create')}</span>
          </ChunkyButton>
        </div>
      </div>

      {net.message && (
        <p role="status" className="font-semibold text-text-muted">
          {net.message}
        </p>
      )}

      <div className="flex flex-col gap-3 rounded-2xl border-2 border-border bg-[var(--color-card)] p-3 sm:flex-row sm:items-center">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <div
            aria-hidden="true"
            className="flex size-11 shrink-0 items-center justify-center rounded-xl border-2 border-nav-active-border bg-nav-active-bg text-secondary"
          >
            <Icon name="timer" size={22} />
          </div>
          <div className="min-w-0">
            <p className="text-[15px] font-extrabold text-text">{t('home.reviewAllTitle')}</p>
            <p className="text-sm font-semibold text-text-muted">
              {totalDue > 0
                ? t('home.reviewAllMeta', { n: totalDue, minutes: estimate })
                : t('home.nothingDue')}
            </p>
          </div>
        </div>
        {first && totalDue > 0 ? (
          <ChunkyButton
            size="sm"
            className="w-full sm:w-auto"
            onClick={() => navigate('/session/all')}
          >
            {t('home.reviewNow')}
          </ChunkyButton>
        ) : null}
      </div>

      <div className="flex items-center justify-between gap-3">
        <h2 className="text-xs font-extrabold uppercase tracking-[0.1em] text-text-subtle">
          {t('home.myDecks')}
          <span className="ml-1.5 text-text-subtle/80">{home.length}</span>
        </h2>
        <button
          type="button"
          className={smallAction}
          onClick={() => fileInput.current?.click()}
          {...net.buttonProps}
        >
          <Icon name="upload" size={14} />
          <span>{t('decks.restore')}</span>
        </button>
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

      {home.length === 0 ? (
        <div className="flex flex-col items-center gap-4 rounded-2xl border-2 border-dashed border-border px-4 py-10 text-center">
          <p className="font-semibold text-text-muted">{t('home.noDecks')}</p>
          <ChunkyButton size="sm" onClick={() => setEditing(null)} {...net.buttonProps}>
            <Icon name="plus" size={16} />
            <span>{t('decks.create')}</span>
          </ChunkyButton>
        </div>
      ) : (
        <>
          {searchable && (
            <label className="relative block">
              <span className="sr-only">{t('home.searchDecks')}</span>
              <Icon
                name="search"
                size={16}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-subtle"
              />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('home.searchDecks')}
                className="h-10 w-full rounded-xl border-2 border-border bg-[var(--color-card)] pl-9 pr-3 text-sm font-bold text-text placeholder:text-text-subtle focus:border-nav-active-border"
              />
            </label>
          )}
          {shown.length === 0 ? (
            <p className="py-6 text-center text-sm font-semibold text-text-muted">
              {t('home.noDeckMatch')}
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {shown.map((d) => (
                <li key={d.deck.id} aria-label={d.deck.name}>
                  <DeckBanner
                    id={d.deck.id}
                    name={d.deck.name}
                    due={d.due}
                    fresh={d.fresh}
                    masteredPct={d.masteredPct}
                    index={home.indexOf(d)}
                    onStudy={() => navigate(`/session/${d.deck.id}`)}
                    actions={
                      <>
                        <button
                          type="button"
                          className={iconAction}
                          aria-label={t('decks.cards')}
                          title={t('decks.cards')}
                          onClick={() => navigate(`/decks/${d.deck.id}/cards`)}
                        >
                          <Icon name="m-style" size={18} />
                        </button>
                        <button
                          type="button"
                          className={`${iconAction} max-sm:hidden`}
                          aria-label={t('decks.import')}
                          title={t('decks.import')}
                          onClick={() => navigate(`/decks/${d.deck.id}/import`)}
                          {...net.buttonProps}
                        >
                          <Icon name="file-spreadsheet" size={18} />
                        </button>
                        <button
                          type="button"
                          className={iconAction}
                          aria-label={t('decks.settings')}
                          title={t('decks.settings')}
                          onClick={() => setEditing(d.deck)}
                        >
                          <Icon name="settings" size={18} />
                        </button>
                      </>
                    }
                  />
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      <DeckSettingsDialog
        open={editing !== undefined}
        deck={editing ?? null}
        cardCount={editing ? (home.find((r) => r.deck.id === editing.id)?.cardCount ?? 0) : 0}
        onClose={() => setEditing(undefined)}
      />
    </section>
  );
}
