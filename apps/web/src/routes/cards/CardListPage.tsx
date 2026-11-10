import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { Link, useNavigate, useParams } from 'react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { useTranslation } from 'react-i18next';
import { htmlToText } from '@anki-duo/domain';
import { content } from '../../client/runtime';
import { dexieStore } from '../../client/store';
import { useOnlineOnly } from '../../client/online-only';
import type { Card } from '../../client/local-store';
import { ChunkyButton, Dialog, Icon, Select, TagChip } from '../../components/ui';
import { notify } from '../../client/notify';
import { describeApiError } from '../../lib/api-error';
import { useMotionPreference } from '../../lib/motion';

type Pending = { kind: 'reset' | 'delete'; card: Card } | null;

const PAGE_SIZE = 20;
const DAY = 86_400_000;

/** Plain-text one-liner of card Markdown for list rows and search. */
function stripMarkdown(md: string): string {
  return md
    .replace(/\[\[audio:[^\]]*\]\]/gi, ' ')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}(?:[-*+]|\d+\.|>|#{1,6})\s+/gm, '')
    .replace(/[*_`~>#]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

interface Row {
  card: Card;
  front: string;
  back: string;
  haystack: string;
}

type Tone = 'due' | 'new' | 'learning' | 'review' | 'suspended';

const toneClass: Record<Tone, string> = {
  due: 'border-danger text-danger-depth',
  new: 'border-secondary text-nav-active-text',
  learning: 'border-orange text-orange-depth',
  review: 'border-primary text-primary-accent',
  suspended: 'border-border-strong text-text-muted',
};

function statusOf(
  t: (key: string) => string,
  card: Card,
  now: number,
): { tone: Tone; label: string } {
  if (card.suspended) return { tone: 'suspended', label: t('cards.suspended') };
  const { state, due, lastReview } = card.fsrs;
  if (state === 'new') return { tone: 'new', label: t('ui.cards.stateNew') };
  const dueAt = new Date(due).getTime();
  if (dueAt <= now) return { tone: 'due', label: t('ui.cards.due') };
  if (state === 'learning' || state === 'relearning') {
    return { tone: 'learning', label: t('ui.cards.stateLearning') };
  }
  const from = lastReview ? new Date(lastReview).getTime() : now;
  return { tone: 'review', label: `${Math.max(1, Math.round((dueAt - from) / DAY))}D` };
}

/** All cards (or one deck's): search, tag filter, row actions (FR-009, FR-012). */
export function CardListPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { deckId = '' } = useParams();
  const net = useOnlineOnly();
  const [query, setQuery] = useState('');
  const [tag, setTag] = useState('');
  const [page, setPage] = useState(0);
  const [pending, setPending] = useState<Pending>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const reducedMotion = useMotionPreference() === 'reduced';

  const decks = useLiveQuery(async () => (await dexieStore.listDecks()).sort(byName), []);
  const cards = useLiveQuery(async () => {
    const ds = deckId ? [{ id: deckId }] : await dexieStore.listDecks();
    const lists = await Promise.all(ds.map((d) => dexieStore.listCards(d.id)));
    return lists.map((l) => l.sort((a, b) => a.position - b.position)).flat();
  }, [deckId]);

  // Filters change the result set, so start again from the first page.
  useEffect(() => {
    setPage(0);
  }, [query, tag, deckId]);

  useEffect(() => {
    if (!menuFor) return;
    const onDown = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuFor(null);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMenuFor(null);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuFor]);

  const rows = useMemo<Row[]>(
    () =>
      (cards ?? []).map((card) => {
        const strip = card.format === 'html' ? htmlToText : stripMarkdown;
        const front = strip(card.front);
        const back = strip(card.back);
        return {
          card,
          front,
          back,
          haystack: `${front}\n${back}\n${card.tags.join(' ')}`.toLowerCase(),
        };
      }),
    [cards],
  );

  const allTags = useMemo(() => [...new Set((cards ?? []).flatMap((c) => c.tags))].sort(), [cards]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase().replace(/^#/, '');
    return rows.filter(
      (r) => (!tag || r.card.tags.includes(tag)) && (!q || r.haystack.includes(q)),
    );
  }, [rows, query, tag]);

  // Clamp so a shrinking result set (e.g. after a delete) never leaves the page empty.
  const pageCount = Math.max(1, Math.ceil(shown.length / PAGE_SIZE));
  const current = Math.min(page, pageCount - 1);
  const pageRows = shown.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE);

  const now = Date.now();
  const targetDeck = deckId || decks?.[0]?.id || '';
  const hasDecks = (decks?.length ?? 0) > 0;
  const deckById = useMemo(() => new Map((decks ?? []).map((d) => [d.id, d.name])), [decks]);

  const act = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (e) {
      notify.show(describeApiError(t, e));
    }
  };

  return (
    <section className="flex min-w-0 flex-col gap-5">
      <div className="flex items-center justify-between gap-3">
        <h1 className="min-w-0 truncate text-[32px] font-extrabold leading-tight text-text">
          {t('cards.title')}
        </h1>
        {hasDecks && (
          <ChunkyButton
            variant="primary"
            onClick={() => navigate(`/decks/${targetDeck}/cards/new`)}
            {...net.buttonProps}
          >
            <Icon name="plus" size={16} />
            <span>{t('cards.add')}</span>
          </ChunkyButton>
        )}
      </div>

      {net.message && (
        <div
          role="status"
          className="rounded-xl border-2 border-border bg-surface p-3.5 text-sm font-bold text-text-muted"
        >
          {net.message}
        </div>
      )}

      <div className="relative">
        <span className="pointer-events-none absolute inset-y-0 left-4 flex items-center text-text-muted">
          <Icon name="search" size={20} />
        </span>
        <input
          type="search"
          aria-label={t('cards.search')}
          placeholder={t('cards.search')}
          className="min-h-12 w-full min-w-0 rounded-2xl border-2 border-border bg-surface pl-12 pr-4 text-sm font-semibold text-text transition-colors placeholder:text-text-subtle focus:border-secondary focus:bg-[var(--color-card)] focus:outline-none"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {(allTags.length > 0 || (decks?.length ?? 0) > 1 || deckId) && (
        <div className="flex flex-wrap items-center gap-2">
          {allTags.length > 0 && (
            <>
              <TagChip
                hash={false}
                label={t('cards.allTags')}
                active={!tag}
                onClick={() => setTag('')}
              />
              {allTags.map((x) => (
                <TagChip
                  key={x}
                  label={x}
                  active={tag === x}
                  onClick={() => setTag(tag === x ? '' : x)}
                />
              ))}
            </>
          )}
          {hasDecks && (
            <div className="ml-auto flex items-center gap-2 text-xs font-bold text-text-muted">
              <label htmlFor="cards-deck-filter" className="sr-only sm:not-sr-only">
                {t('ui.cards.deckFilter')}
              </label>
              <Select
                id="cards-deck-filter"
                aria-label={t('ui.cards.deckFilter')}
                size="sm"
                align="right"
                className="max-w-48"
                value={deckId}
                onChange={(val) => navigate(val ? `/decks/${val}/cards` : '/cards')}
                options={[
                  { value: '', label: t('ui.cards.allDecks') },
                  ...decks!.map((d) => ({ value: d.id, label: d.name })),
                ]}
              />
            </div>
          )}
        </div>
      )}

      {cards === undefined || decks === undefined ? (
        <p role="status" className="py-8 text-center font-bold text-text-muted">
          {t('common.loading')}
        </p>
      ) : !hasDecks ? (
        <div className="rounded-[var(--radius-card)] border-2 border-dashed border-border bg-surface p-8 text-center text-text-muted">
          <p className="font-bold">{t('ui.cards.noDecks')}</p>
          <Link
            to="/"
            className="mt-3 inline-block text-sm font-extrabold uppercase tracking-wider text-nav-active-text underline"
          >
            {t('ui.cards.createDeck')}
          </Link>
        </div>
      ) : cards.length === 0 ? (
        <div className="rounded-[var(--radius-card)] border-2 border-dashed border-border bg-surface p-8 text-center text-text-muted">
          <p className="font-bold">{t('cards.empty')}</p>
        </div>
      ) : shown.length === 0 ? (
        <div className="rounded-[var(--radius-card)] border-2 border-dashed border-border bg-surface p-8 text-center text-text-muted">
          <p className="font-bold">{t('cards.noMatch')}</p>
        </div>
      ) : (
        <>
          <ul className="divide-y-2 divide-border rounded-[var(--radius-card)] border-2 border-border bg-[var(--color-card)]">
            {pageRows.map(({ card: c, front, back }) => {
              const status = statusOf(t, c, now);
              const open = menuFor === c.id;
              return (
                <li key={c.id} className="relative flex items-center">
                  <Link
                    to={`/decks/${c.deckId}/cards/${c.id}`}
                    className="flex min-w-0 flex-1 items-center gap-3 rounded-[var(--radius-card)] px-5 py-3.5 transition-colors duration-[var(--duration-fast)] hover:bg-surface focus-visible:-outline-offset-2"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-base font-extrabold text-text">
                        {front}
                      </span>
                      <span className="block truncate text-[13px] font-semibold text-text-muted">
                        {back}
                        {!deckId && deckById.size > 1 && (
                          <span className="text-text-subtle">
                            {back ? ' · ' : ''}
                            {deckById.get(c.deckId)}
                          </span>
                        )}
                      </span>
                    </span>
                    <span
                      className={`shrink-0 rounded-full border-2 px-2.5 py-0.5 text-[11px] font-extrabold uppercase tracking-wide ${toneClass[status.tone]}`}
                    >
                      {status.label}
                    </span>
                  </Link>
                  <div ref={open ? menuRef : undefined} className="relative shrink-0 pr-2">
                    <button
                      type="button"
                      aria-label={t('ui.cards.actions')}
                      aria-haspopup="menu"
                      aria-expanded={open}
                      onClick={() => setMenuFor(open ? null : c.id)}
                      className="flex h-11 w-9 cursor-pointer items-center justify-center rounded-lg text-text-subtle transition-[transform,background-color,color] duration-[var(--duration-fast)] hover:bg-surface hover:text-text enabled:active:scale-95"
                    >
                      <Icon name="ellipsis" size={18} />
                    </button>
                    {open && (
                      <motion.div
                        role="menu"
                        initial={reducedMotion ? false : { scale: 0.95, y: -4 }}
                        animate={{ scale: 1, y: 0 }}
                        transition={reducedMotion ? { duration: 0.01 } : { duration: 0.12 }}
                        className="absolute right-2 top-11 z-10 flex w-44 origin-top-right flex-col rounded-xl border-2 border-border bg-[var(--color-card)] p-1 shadow-lg"
                      >
                        <MenuItem
                          disabled={!net.online}
                          icon={c.suspended ? 'eye' : 'eye-off'}
                          label={c.suspended ? t('cards.unsuspend') : t('cards.suspend')}
                          onClick={() => {
                            setMenuFor(null);
                            void act(() => content.updateCard(c.id, { suspended: !c.suspended }));
                          }}
                        />
                        <MenuItem
                          disabled={!net.online}
                          icon="rotate-ccw"
                          label={t('cards.reset')}
                          onClick={() => {
                            setMenuFor(null);
                            setPending({ kind: 'reset', card: c });
                          }}
                        />
                        <MenuItem
                          disabled={!net.online}
                          danger
                          icon="trash-2"
                          label={t('cards.delete')}
                          onClick={() => {
                            setMenuFor(null);
                            setPending({ kind: 'delete', card: c });
                          }}
                        />
                      </motion.div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>

          <div className="flex flex-wrap items-center justify-between gap-3 text-xs font-bold text-text-muted">
            <span>
              {t('ui.cards.showingRange', {
                from: current * PAGE_SIZE + 1,
                to: Math.min((current + 1) * PAGE_SIZE, shown.length),
                total: shown.length,
              })}
            </span>
            {pageCount > 1 && (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  aria-label={t('ui.cards.prevPage')}
                  disabled={current === 0}
                  onClick={() => setPage(current - 1)}
                  className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-xl border-2 border-border bg-[var(--color-card)] text-text-muted transition-[transform,background-color,color] duration-[var(--duration-fast)] hover:bg-surface hover:text-text enabled:active:scale-90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Icon name="chevron-left" size={18} />
                </button>
                <span className="tabular-nums text-text-muted">
                  {t('ui.cards.pageOf', { page: current + 1, count: pageCount })}
                </span>
                <button
                  type="button"
                  aria-label={t('ui.cards.nextPage')}
                  disabled={current >= pageCount - 1}
                  onClick={() => setPage(current + 1)}
                  className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-xl border-2 border-border bg-[var(--color-card)] text-text-muted transition-[transform,background-color,color] duration-[var(--duration-fast)] hover:bg-surface hover:text-text enabled:active:scale-90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Icon name="chevron-right" size={18} />
                </button>
              </div>
            )}
            {hasDecks && (
              <Link
                to={`/decks/${targetDeck}/import`}
                className="font-extrabold uppercase tracking-wider text-nav-active-text underline"
              >
                {t('decks.import')}
              </Link>
            )}
          </div>
        </>
      )}

      <Dialog
        open={pending !== null}
        title={pending?.kind === 'reset' ? t('cards.resetTitle') : t('cards.deleteTitle')}
        onClose={() => setPending(null)}
      >
        <p className="mb-5 text-sm font-semibold text-text">
          {pending?.kind === 'reset' ? t('cards.resetConfirm') : t('cards.deleteConfirm')}
        </p>
        <div className="flex justify-end gap-2.5">
          <ChunkyButton variant="neutral" onClick={() => setPending(null)}>
            {t('common.cancel')}
          </ChunkyButton>
          <ChunkyButton
            variant={pending?.kind === 'delete' ? 'danger' : 'primary'}
            disabled={!net.online}
            onClick={() => {
              const p = pending;
              setPending(null);
              if (p) {
                void act(() =>
                  p.kind === 'reset' ? content.resetCard(p.card.id) : content.deleteCard(p.card.id),
                );
              }
            }}
          >
            {pending?.kind === 'reset' ? t('cards.reset') : t('cards.delete')}
          </ChunkyButton>
        </div>
      </Dialog>
    </section>
  );
}

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);

function MenuItem({
  icon,
  label,
  onClick,
  disabled,
  danger,
}: {
  icon: Parameters<typeof Icon>[0]['name'];
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      className={`flex min-h-11 cursor-pointer items-center gap-2.5 rounded-lg px-3 text-left text-sm font-bold transition-[transform,background-color,color] duration-[var(--duration-fast)] hover:bg-surface enabled:active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 ${danger ? 'text-danger-depth' : 'text-text'}`}
    >
      <Icon name={icon} size={16} />
      {label}
    </button>
  );
}
