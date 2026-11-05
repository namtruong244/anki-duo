import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { useTranslation } from 'react-i18next';
import { content } from '../../client/runtime';
import { dexieStore } from '../../client/store';
import { useOnlineOnly } from '../../client/online-only';
import type { Card } from '../../client/local-store';
import { ChunkyButton, Dialog } from '../../components/ui';
import { notify } from '../../client/notify';
import { describeApiError } from '../../lib/api-error';

type Pending = { kind: 'reset' | 'delete'; card: Card } | null;

/** Cards of a deck: search, tag filter, suspend, reset and delete (FR-009, FR-012). */
export function CardListPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { deckId = '' } = useParams();
  const net = useOnlineOnly();
  const [query, setQuery] = useState('');
  const [tag, setTag] = useState('');
  const [pending, setPending] = useState<Pending>(null);

  const deck = useLiveQuery(() => dexieStore.getDeck(deckId), [deckId]);
  const cards = useLiveQuery(
    async () => (await dexieStore.listCards(deckId)).sort((a, b) => a.position - b.position),
    [deckId],
  );

  const allTags = useMemo(() => [...new Set((cards ?? []).flatMap((c) => c.tags))].sort(), [cards]);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (cards ?? []).filter(
      (c) =>
        (!tag || c.tags.includes(tag)) &&
        (!q || c.front.toLowerCase().includes(q) || c.back.toLowerCase().includes(q)),
    );
  }, [cards, query, tag]);

  const act = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (e) {
      notify.show(describeApiError(t, e));
    }
  };

  return (
    <section className="py-4">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">
          {deck ? `${deck.name} · ${t('cards.title')}` : t('cards.title')}
        </h1>
        <ChunkyButton onClick={() => navigate(`/decks/${deckId}/cards/new`)} {...net.buttonProps}>
          {t('cards.add')}
        </ChunkyButton>
      </div>
      {net.message && (
        <p role="status" className="mb-3 text-text-muted">
          {net.message}
        </p>
      )}
      <div className="mb-4 flex flex-wrap gap-2">
        <input
          type="search"
          aria-label={t('cards.search')}
          placeholder={t('cards.search')}
          className="min-h-11 flex-1 rounded-lg border border-border px-3"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select
          aria-label={t('cards.tagFilter')}
          className="min-h-11 rounded-lg border border-border px-3"
          value={tag}
          onChange={(e) => setTag(e.target.value)}
        >
          <option value="">{t('cards.allTags')}</option>
          {allTags.map((x) => (
            <option key={x} value={x}>
              {x}
            </option>
          ))}
        </select>
      </div>

      {cards === undefined ? (
        <p role="status">{t('common.loading')}</p>
      ) : cards.length === 0 ? (
        <p>{t('cards.empty')}</p>
      ) : shown.length === 0 ? (
        <p>{t('cards.noMatch')}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {shown.map((c) => (
            <li
              key={c.id}
              className="rounded-[var(--radius-card)] border border-border bg-surface p-4"
            >
              <p className="line-clamp-2 font-bold break-words">{c.front}</p>
              <p className="line-clamp-2 text-sm break-words text-text-muted">{c.back}</p>
              <p className="mt-1 text-sm text-text-muted">
                {c.tags.map((x) => `#${x}`).join(' ')}
                {c.suspended && <span className="ml-2 font-bold">{t('cards.suspended')}</span>}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Link
                  to={`/decks/${deckId}/cards/${c.id}`}
                  className="inline-flex min-h-11 items-center rounded-full border border-border px-4"
                >
                  {t('cards.edit')}
                </Link>
                <ChunkyButton
                  variant="neutral"
                  {...net.buttonProps}
                  onClick={() =>
                    void act(() => content.updateCard(c.id, { suspended: !c.suspended }))
                  }
                >
                  {c.suspended ? t('cards.unsuspend') : t('cards.suspend')}
                </ChunkyButton>
                <ChunkyButton
                  variant="neutral"
                  {...net.buttonProps}
                  onClick={() => setPending({ kind: 'reset', card: c })}
                >
                  {t('cards.reset')}
                </ChunkyButton>
                <ChunkyButton
                  variant="danger"
                  {...net.buttonProps}
                  onClick={() => setPending({ kind: 'delete', card: c })}
                >
                  {t('cards.delete')}
                </ChunkyButton>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Dialog
        open={pending !== null}
        title={pending?.kind === 'reset' ? t('cards.resetTitle') : t('cards.deleteTitle')}
        onClose={() => setPending(null)}
      >
        <p className="mb-4">
          {pending?.kind === 'reset' ? t('cards.resetConfirm') : t('cards.deleteConfirm')}
        </p>
        <div className="flex justify-end gap-2">
          <ChunkyButton variant="neutral" onClick={() => setPending(null)}>
            {t('common.cancel')}
          </ChunkyButton>
          <ChunkyButton
            variant={pending?.kind === 'delete' ? 'danger' : 'primary'}
            disabled={!net.online}
            onClick={() => {
              const p = pending;
              setPending(null);
              if (p)
                void act(() =>
                  p.kind === 'reset' ? content.resetCard(p.card.id) : content.deleteCard(p.card.id),
                );
            }}
          >
            {pending?.kind === 'reset' ? t('cards.reset') : t('cards.delete')}
          </ChunkyButton>
        </div>
      </Dialog>
    </section>
  );
}
