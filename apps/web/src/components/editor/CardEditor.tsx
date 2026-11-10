import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useTranslation } from 'react-i18next';
import { content } from '../../client/runtime';
import { dexieStore } from '../../client/store';
import { validateCard } from '../../client/card-validation';
import { useOnlineOnly } from '../../client/online-only';
import { CardContent } from '../session/CardContent';
import { MediaPicker } from './MediaPicker';
import { ChunkyButton, Icon, Select, type IconName } from '../ui';
import type { Card } from '../../client/local-store';
import { notify } from '../../client/notify';
import { describeApiError } from '../../lib/api-error';

const FORM_ID = 'card-editor-form';
type Side = 'front' | 'back';

const fieldClass =
  'min-w-0 w-full rounded-2xl border-2 border-border bg-surface px-4 text-sm font-semibold text-text transition-colors placeholder:text-text-subtle focus:border-secondary focus:bg-[var(--color-card)] focus:outline-none disabled:opacity-60';
const labelClass = 'text-[11px] font-extrabold uppercase tracking-[0.1em] text-text-muted';

interface Edit {
  /** Markdown to put around the selection (or `before` only for line prefixes). */
  before: string;
  after: string;
  placeholder: string;
  /** Prefix every selected line instead of wrapping. */
  linePrefix?: boolean;
}

const TOOLS: { key: string; icon: IconName; edit: Edit }[] = [
  { key: 'bold', icon: 'bold', edit: { before: '**', after: '**', placeholder: 'bold' } },
  { key: 'italic', icon: 'italic', edit: { before: '*', after: '*', placeholder: 'italic' } },
  { key: 'code', icon: 'code', edit: { before: '`', after: '`', placeholder: 'code' } },
  {
    key: 'list',
    icon: 'list',
    edit: { before: '- ', after: '', placeholder: 'item', linePrefix: true },
  },
  { key: 'link', icon: 'link', edit: { before: '[', after: '](https://)', placeholder: 'link' } },
  { key: 'image', icon: 'image', edit: { before: '![', after: '](https://)', placeholder: 'alt' } },
];

/** Pure text transform used by the toolbar: returns new value and selection range. */
function applyEdit(value: string, start: number, end: number, e: Edit) {
  const selected = value.slice(start, end);
  if (e.linePrefix) {
    const lineStart = value.lastIndexOf('\n', start - 1) + 1;
    const block = value.slice(lineStart, end) || e.placeholder;
    const next = block
      .split('\n')
      .map((l) => `${e.before}${l}`)
      .join('\n');
    return {
      value: value.slice(0, lineStart) + next + value.slice(end),
      from: lineStart,
      to: lineStart + next.length,
    };
  }
  const text = selected || e.placeholder;
  const next = `${e.before}${text}${e.after}`;
  return {
    value: value.slice(0, start) + next + value.slice(end),
    from: start + e.before.length,
    to: start + e.before.length + text.length,
  };
}

/**
 * Create or edit a card (frame "Card Editor"): form on the left, live preview on the right.
 * Media can be attached once the card exists (the upload is tied to a card id), so a new card is
 * saved first. A card cannot move between decks (the API has no such operation), so the deck
 * select is only active for new cards.
 */
export interface CardEditorProps {
  deckId: string;
  cardId?: string | undefined;
  onClose: () => void;
  /** Called after a card is saved. For a new card, the page navigates to its editor instead. */
  onSaved?: (card: Card) => void;
  /** Called after a new card is created (the editor stays open to attach media). */
  onCreated?: (card: { id: string; deckId: string }) => void;
}

export function CardEditor({ deckId, cardId, onClose, onSaved, onCreated }: CardEditorProps) {
  const { t } = useTranslation();
  const net = useOnlineOnly();
  const [front, setFront] = useState('');
  const [back, setBack] = useState('');
  const [tags, setTags] = useState('');
  const [targetDeck, setTargetDeck] = useState(deckId);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(!cardId);
  const [active, setActive] = useState<Side>('front');
  const areas = {
    front: useRef<HTMLTextAreaElement>(null),
    back: useRef<HTMLTextAreaElement>(null),
  };

  const decks = useLiveQuery(
    async () => (await dexieStore.listDecks()).sort((a, b) => a.name.localeCompare(b.name)),
    [],
  );

  useEffect(() => {
    setTargetDeck(deckId);
  }, [deckId]);

  useEffect(() => {
    if (!cardId) return;
    void dexieStore.getCard(cardId).then((c) => {
      if (c) {
        setFront(c.front);
        setBack(c.back);
        setTags(c.tags.map((x) => `#${x}`).join(' '));
      }
      setLoaded(true);
    });
  }, [cardId]);

  const close = onClose;

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    const v = validateCard(front, back, tags.replace(/#/g, ''));
    if (!v.ok) return setError(t(`cards.errors.${v.error}`));
    setError(null);
    try {
      if (cardId) {
        await content.updateCard(cardId, { front: v.front, back: v.back, tags: v.tags });
        notify.show(t('cards.saved'));
        const saved = await dexieStore.getCard(cardId);
        if (saved) onSaved?.(saved);
        close();
      } else {
        const created = await content.createCard(targetDeck, {
          front: v.front,
          back: v.back,
          tags: v.tags,
        });
        notify.show(t('cards.saved'));
        // Stay in the editor so media can be attached to the saved card.
        onCreated?.({ id: created.id, deckId: targetDeck });
      }
    } catch (err) {
      setError(describeApiError(t, err));
    }
  };

  const setters = { front: setFront, back: setBack };
  const values = { front, back };

  const insertAt = (
    side: Side,
    make: (v: string, s: number, e: number) => ReturnType<typeof applyEdit>,
  ) => {
    const ta = areas[side].current;
    const value = values[side];
    const start = ta?.selectionStart ?? value.length;
    const end = ta?.selectionEnd ?? value.length;
    const r = make(value, start, end);
    setters[side](r.value);
    requestAnimationFrame(() => {
      ta?.focus();
      ta?.setSelectionRange(r.from, r.to);
    });
  };

  const runTool = (edit: Edit) => insertAt(active, (v, s, e) => applyEdit(v, s, e, edit));

  const insertToken = (side: Side) => (token: string) =>
    setters[side]((v) => `${v}${v ? '\n\n' : ''}${token}`);

  const tagList = tags
    .split(/\s+/)
    .map((x) => x.replace(/^#+/, ''))
    .filter(Boolean);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      void submit();
    }
  };

  const textarea = (side: Side) => (
    <textarea
      ref={areas[side]}
      id={`card-${side}`}
      className={`${fieldClass} min-h-24 resize-y py-3 font-mono leading-relaxed`}
      value={values[side]}
      onChange={(e) => setters[side](e.target.value)}
      onFocus={() => setActive(side)}
      onKeyDown={onKeyDown}
      disabled={!net.online}
    />
  );

  return (
    <section className="flex min-w-0 flex-col gap-5">
      <div className="flex items-center justify-between gap-3">
        <h1 className="min-w-0 truncate text-[32px] font-extrabold leading-tight text-text">
          {cardId ? t('cards.editTitle') : t('cards.newTitle')}
        </h1>
        <div className="flex shrink-0 items-center gap-3">
          <ChunkyButton variant="outline" onClick={close}>
            {t('cards.close')}
          </ChunkyButton>
          <ChunkyButton type="submit" form={FORM_ID} variant="primary" {...net.buttonProps}>
            {t('cards.save')}
          </ChunkyButton>
        </div>
      </div>

      {net.message && (
        <div
          role="status"
          className="rounded-xl border-2 border-border bg-surface p-3.5 text-sm font-bold text-text-muted"
        >
          {net.message}
        </div>
      )}

      {!loaded ? (
        <p role="status" className="p-8 text-center font-bold text-text-muted">
          {t('common.loading')}
        </p>
      ) : (
        <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <form id={FORM_ID} onSubmit={submit} className="flex min-w-0 flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="card-deck" className={labelClass}>
                {t('ui.editor.deck')}
              </label>
              <Select
                id="card-deck"
                value={targetDeck}
                disabled={!!cardId || !net.online}
                onChange={(val) => setTargetDeck(val)}
                options={(decks ?? []).map((d) => ({ value: d.id, label: d.name }))}
              />
              {cardId && (
                <p className="text-xs font-semibold text-text-muted">{t('ui.editor.deckLocked')}</p>
              )}
            </div>

            <div
              role="toolbar"
              aria-label={t('ui.editor.toolbar')}
              className="flex flex-wrap gap-2"
            >
              {TOOLS.map((tool) => (
                <button
                  key={tool.key}
                  type="button"
                  aria-label={t(`ui.editor.tools.${tool.key}`)}
                  title={t(`ui.editor.tools.${tool.key}`)}
                  disabled={!net.online}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => runTool(tool.edit)}
                  className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-xl border-2 border-border bg-[var(--color-card)] text-text-muted transition-[transform,background-color,color] duration-[var(--duration-fast)] hover:bg-surface hover:text-text enabled:active:scale-90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Icon name={tool.icon} size={18} />
                </button>
              ))}
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="card-front" className={labelClass}>
                {t('ui.editor.frontMd')}
              </label>
              {textarea('front')}
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="card-back" className={labelClass}>
                {t('ui.editor.backMd')}
              </label>
              {textarea('back')}
            </div>

            <MediaPicker
              cardId={cardId}
              side={active}
              onInsert={(tok) => insertToken(active)(tok)}
            />

            <div className="flex flex-col gap-1.5">
              <label htmlFor="card-tags" className={labelClass}>
                {t('ui.editor.tag')}
              </label>
              <input
                id="card-tags"
                className={`${fieldClass} min-h-12`}
                value={tags}
                placeholder={t('cards.tagsHint')}
                onChange={(e) => setTags(e.target.value)}
                onKeyDown={onKeyDown}
                disabled={!net.online}
              />
            </div>

            {error && (
              <p
                role="alert"
                className="rounded-xl border-2 border-danger bg-danger-tint p-3 text-sm font-bold text-text"
              >
                {error}
              </p>
            )}
          </form>

          <div className="flex min-w-0 flex-col gap-1.5">
            <h2 className={labelClass}>{t('ui.cards.livePreview')}</h2>
            <div
              aria-label={t('ui.cards.livePreview')}
              className="flex min-w-0 flex-col gap-4 rounded-3xl border-2 border-border bg-[var(--color-card)] p-6"
            >
              {tagList.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {tagList.map((tg, i) => (
                    <span
                      key={i}
                      className="inline-flex items-center rounded-lg border-2 border-border px-2.5 py-0.5 text-xs font-extrabold text-nav-active-text"
                    >
                      #{tg}
                    </span>
                  ))}
                </div>
              )}
              {front ? (
                <CardContent markdown={front} className="text-2xl font-extrabold text-text" />
              ) : (
                <p className="text-sm italic text-text-subtle">—</p>
              )}
              <hr className="border-t-2 border-border" />
              {back ? (
                <CardContent markdown={back} className="text-text" />
              ) : (
                <p className="text-sm italic text-text-subtle">—</p>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
