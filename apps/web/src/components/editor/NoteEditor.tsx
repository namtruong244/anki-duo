import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { renderCard, sanitizeHtml, type NoteTypeDef } from '@anki-duo/domain';
import { content } from '../../client/runtime';
import type { Note } from '../../client/content';
import type { NoteType } from '../../client/local-store';
import { useOnlineOnly } from '../../client/online-only';
import { notify } from '../../client/notify';
import { describeApiError } from '../../lib/api-error';
import { CardHtml } from '../card/CardHtml';
import { ChunkyButton, Select } from '../ui';
import { RichFieldEditor } from './RichFieldEditor';
import { useRemovalConfirm } from './RemovalConfirm';
import { vanishedNoteCardIds } from '../../client/removal';

export const LAST_NOTE_TYPE_KEY = 'anki-duo.lastNoteType';

const fieldClass =
  'min-w-0 w-full rounded-2xl border-2 border-border bg-surface px-4 text-sm font-semibold text-text transition-colors placeholder:text-text-subtle focus:border-secondary focus:bg-[var(--color-card)] focus:outline-none disabled:opacity-60';
const labelClass = 'text-[11px] font-extrabold uppercase tracking-[0.1em] text-text-muted';

const readLast = () => {
  try {
    return localStorage.getItem(LAST_NOTE_TYPE_KEY);
  } catch {
    return null;
  }
};
const writeLast = (id: string) => {
  try {
    localStorage.setItem(LAST_NOTE_TYPE_KEY, id);
  } catch {
    /* storage unavailable: the default just won't be remembered */
  }
};

export interface NoteEditorProps {
  deckId: string;
  /** Present when editing; the note type is then fixed. */
  note?: Note | undefined;
  onClose: () => void;
  onCreated?: (note: Note) => void;
  onSaved?: (note: Note) => void;
}

const parseTags = (s: string) =>
  s
    .split(/\s+/)
    .map((x) => x.replace(/^#+/, ''))
    .filter(Boolean);

/** Create or edit a note: one rich editor per field plus a live preview of every card template. */
export function NoteEditor({ deckId, note, onClose, onCreated, onSaved }: NoteEditorProps) {
  const { t } = useTranslation();
  const net = useOnlineOnly();
  const [types, setTypes] = useState<NoteType[] | null>(null);
  const [typeId, setTypeId] = useState(note?.noteTypeId ?? '');
  const [fields, setFields] = useState<Record<string, string>>(note?.fields ?? {});
  const [tags, setTags] = useState((note?.tags ?? []).map((x) => `#${x}`).join(' '));
  const [tab, setTab] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [resetKey, setResetKey] = useState(0);
  const removal = useRemovalConfirm((e) => setError(describeApiError(t, e)));

  useEffect(() => {
    let live = true;
    content
      .listNoteTypes()
      .then((rows) => {
        if (!live) return;
        setTypes(rows);
        setTypeId((cur) => {
          if (cur) return cur;
          const last = readLast();
          return (
            rows.find((r) => r.id === last)?.id ??
            rows.find((r) => r.name === 'Basic')?.id ??
            rows[0]?.id ??
            ''
          );
        });
      })
      .catch((e) => {
        if (live) {
          setTypes([]);
          setError(describeApiError(t, e));
        }
      });
    return () => {
      live = false;
    };
  }, [t]);

  const type = types?.find((x) => x.id === typeId);
  const def: NoteTypeDef | null = type
    ? {
        fields: type.fields,
        templates: type.templates,
        css: type.css,
        kind: type.kind,
        options: type.options,
      }
    : null;
  const activeTpl = def?.templates.find((x) => x.id === tab) ?? def?.templates[0];

  const preview = useMemo(() => {
    if (!def || !activeTpl) return null;
    return renderCard(def, fields, note?.extra ?? null, {
      templateId: activeTpl.id,
      ordinal: 0,
      tags: parseTags(tags),
    });
  }, [def, activeTpl, fields, tags, note?.extra]);

  const save = async (another: boolean) => {
    if (!type) return;
    setError(null);
    setSaving(true);
    try {
      const clean = Object.fromEntries(
        type.fields.map((f) => [f.id, sanitizeHtml(fields[f.id] ?? '')]),
      );
      const tagList = parseTags(tags);
      if (note) {
        const vanished = def ? vanishedNoteCardIds(def, note, clean, note.extra) : [];
        await removal.guard(vanished, async (confirmRemoval) => {
          const saved = await content.updateNote(note.id, {
            fields: clean,
            tags: tagList,
            ...(confirmRemoval ? { confirmRemoval: true } : {}),
          });
          notify.show(t('notes.editor.saved'));
          onSaved?.(saved);
          onClose();
        });
      } else {
        writeLast(type.id);
        const created = await content.createNote(deckId, {
          noteTypeId: type.id,
          fields: clean,
          tags: tagList,
        });
        notify.show(t('notes.editor.saved'));
        if (another) {
          setFields({});
          setResetKey((k) => k + 1);
        } else onCreated?.(created);
      }
    } catch (e) {
      setError(describeApiError(t, e));
    } finally {
      setSaving(false);
    }
  };

  const disabled = !net.online || saving;

  return (
    <section className="flex min-w-0 flex-col gap-5">
      <div className="flex items-center justify-between gap-3">
        <h1 className="min-w-0 truncate text-[32px] font-extrabold leading-tight text-text">
          {note ? t('notes.editor.editTitle') : t('notes.editor.newTitle')}
        </h1>
        <div className="flex shrink-0 flex-wrap items-center gap-3">
          <ChunkyButton variant="outline" onClick={onClose}>
            {t('cards.close')}
          </ChunkyButton>
          {!note && (
            <ChunkyButton
              variant="neutral"
              disabled={disabled || !type}
              onClick={() => void save(true)}
            >
              {t('notes.editor.saveAndAdd')}
            </ChunkyButton>
          )}
          <ChunkyButton
            variant="primary"
            disabled={disabled || !type}
            title={net.message ?? undefined}
            onClick={() => void save(false)}
          >
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

      {types === null ? (
        <p role="status" className="p-8 text-center font-bold text-text-muted">
          {t('common.loading')}
        </p>
      ) : (
        <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <form
            className="flex min-w-0 flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              void save(false);
            }}
          >
            <div className="flex flex-col gap-1.5">
              <label htmlFor="note-type" className={labelClass}>
                {t('notes.editor.noteType')}
              </label>
              <Select
                id="note-type"
                value={typeId}
                disabled={!!note || !net.online}
                onChange={setTypeId}
                options={types.map((x) => ({ value: x.id, label: x.name }))}
              />
              {note && (
                <p className="text-xs font-semibold text-text-muted">
                  {t('notes.editor.typeLocked')}
                </p>
              )}
              <Link to="/note-types" className="text-xs font-extrabold text-secondary underline">
                {t('notes.editor.manageTypes')}
              </Link>
            </div>

            {type?.fields.map((f) => (
              <RichFieldEditor
                key={`${resetKey}-${type.id}-${f.id}`}
                id={`note-field-${f.id}`}
                label={f.name}
                value={fields[f.id] ?? ''}
                onChange={(html) => setFields((cur) => ({ ...cur, [f.id]: html }))}
                disabled={!net.online}
                mediaCardId={note?.cards[0]?.id}
              />
            ))}

            <div className="flex flex-col gap-1.5">
              <label htmlFor="note-tags" className={labelClass}>
                {t('ui.editor.tag')}
              </label>
              <input
                id="note-tags"
                className={`${fieldClass} min-h-12`}
                value={tags}
                placeholder={t('cards.tagsHint')}
                onChange={(e) => setTags(e.target.value)}
                disabled={!net.online}
              />
            </div>
          </form>

          <div className="flex min-w-0 flex-col gap-2">
            <h2 className={labelClass}>{t('ui.cards.livePreview')}</h2>
            {def && (
              <div role="tablist" className="flex flex-wrap gap-2">
                {def.templates.map((tpl) => (
                  <button
                    key={tpl.id}
                    type="button"
                    role="tab"
                    aria-selected={tpl.id === activeTpl?.id}
                    onClick={() => setTab(tpl.id)}
                    className="cursor-pointer rounded-xl border-2 border-border px-3 py-1.5 text-xs font-extrabold text-text-muted aria-selected:border-nav-active-border aria-selected:bg-nav-active-bg aria-selected:text-nav-active-text"
                  >
                    {tpl.name}
                  </button>
                ))}
              </div>
            )}
            {preview && def && (
              <div
                aria-label={t('ui.cards.livePreview')}
                className="flex min-w-0 flex-col gap-3 rounded-3xl border-2 border-border bg-[var(--color-card)] p-6"
              >
                <p className={labelClass}>{t('cards.front')}</p>
                <CardHtml html={preview.front} css={def.css} />
                <p className={labelClass}>{t('cards.back')}</p>
                <CardHtml html={preview.back} css={def.css} />
              </div>
            )}
          </div>
        </div>
      )}
      {removal.dialog}
      {error && (
        <p
          role="alert"
          className="rounded-xl border-2 border-danger bg-danger-tint p-3 text-sm font-bold text-text"
        >
          {error}
        </p>
      )}
    </section>
  );
}
