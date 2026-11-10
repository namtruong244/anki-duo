import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import {
  newNoteTypeId,
  renameFieldInTemplates,
  renderCard,
  validateNoteType,
  type NoteTypeDef,
} from '@anki-duo/domain';
import { content } from '../../client/runtime';
import { useOnlineOnly } from '../../client/online-only';
import { notify } from '../../client/notify';
import { describeApiError } from '../../lib/api-error';
import { CardHtml } from '../../components/card/CardHtml';
import { ChunkyButton, Dialog, Select } from '../../components/ui';

const inputClass =
  'min-h-10 min-w-0 flex-1 rounded-xl border-2 border-border bg-surface px-3 text-sm font-semibold text-text focus:border-secondary focus:outline-none disabled:opacity-60';
const areaClass =
  'min-h-24 w-full resize-y rounded-2xl border-2 border-border bg-surface px-4 py-3 font-mono text-sm leading-relaxed text-text focus:border-secondary focus:outline-none disabled:opacity-60';
const labelClass = 'text-[11px] font-extrabold uppercase tracking-[0.1em] text-text-muted';

type Side = 'front' | 'back';

/** Anki-style "Fields…" + "Cards…" editor for one note type. */
export function NoteTypeEditorPage() {
  const { t } = useTranslation();
  const net = useOnlineOnly();
  const navigate = useNavigate();
  const { noteTypeId = '' } = useParams();
  const [name, setName] = useState('');
  const [def, setDef] = useState<NoteTypeDef | null>(null);
  const [tplId, setTplId] = useState('');
  const [active, setActive] = useState<Side>('front');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [dropField, setDropField] = useState<string | null>(null);
  const [dropTpl, setDropTpl] = useState<string | null>(null);
  const areas = {
    front: useRef<HTMLTextAreaElement>(null),
    back: useRef<HTMLTextAreaElement>(null),
  };

  useEffect(() => {
    let live = true;
    content
      .listNoteTypes()
      .then((rows) => {
        const nt = rows.find((r) => r.id === noteTypeId);
        if (!live) return;
        if (!nt) return setError(t('problem.not_found'));
        setName(nt.name);
        setDef({ fields: nt.fields, templates: nt.templates, css: nt.css });
        setTplId(nt.templates[0]?.id ?? '');
      })
      .catch((e) => live && setError(describeApiError(t, e)));
    return () => {
      live = false;
    };
  }, [noteTypeId, t]);

  const errors = useMemo(() => (def ? validateNoteType(def) : []), [def]);
  const tpl = def?.templates.find((x) => x.id === tplId) ?? def?.templates[0];

  const preview = useMemo(() => {
    if (!def || !tpl) return null;
    try {
      const sample = Object.fromEntries(def.fields.map((f) => [f.id, f.name]));
      return renderCard(def, tpl, sample);
    } catch {
      return null;
    }
  }, [def, tpl]);

  if (!def || !tpl) {
    return error ? (
      <p role="alert" className="p-8 text-center font-bold text-text">
        {error}
      </p>
    ) : (
      <p role="status" className="p-8 text-center font-bold text-text-muted">
        {t('common.loading')}
      </p>
    );
  }

  const patch = (fn: (d: NoteTypeDef) => NoteTypeDef) => setDef((d) => (d ? fn(d) : d));
  const setTpl = (id: string, change: Partial<NoteTypeDef['templates'][number]>) =>
    patch((d) => ({
      ...d,
      templates: d.templates.map((x) => (x.id === id ? { ...x, ...change } : x)),
    }));

  const renameField = (id: string, next: string) =>
    patch((d) => {
      const old = d.fields.find((f) => f.id === id)?.name ?? '';
      const fields = d.fields.map((f) => (f.id === id ? { ...f, name: next } : f));
      const base = old && next ? renameFieldInTemplates(d, old, next) : d;
      return { ...base, fields };
    });

  const moveField = (i: number, dir: -1 | 1) =>
    patch((d) => {
      const fields = [...d.fields];
      const j = i + dir;
      if (j < 0 || j >= fields.length) return d;
      [fields[i], fields[j]] = [fields[j]!, fields[i]!];
      return { ...d, fields };
    });

  const addField = () =>
    patch((d) => ({
      ...d,
      fields: [
        ...d.fields,
        { id: newNoteTypeId('f'), name: t('notes.types.newFieldName', { n: d.fields.length + 1 }) },
      ],
    }));

  const addTemplate = () => {
    const id = newNoteTypeId('t');
    patch((d) => ({
      ...d,
      templates: [
        ...d.templates,
        {
          id,
          name: t('notes.types.newTemplateName', { n: d.templates.length + 1 }),
          front: `{{${d.fields[0]?.name ?? ''}}}`,
          back: `{{FrontSide}}<hr id=answer>{{${d.fields[1]?.name ?? d.fields[0]?.name ?? ''}}}`,
        },
      ],
    }));
    setTplId(id);
  };

  const insertField = (fieldName: string) => {
    if (!fieldName) return;
    const ta = areas[active].current;
    const value = tpl[active];
    const s = ta?.selectionStart ?? value.length;
    const e = ta?.selectionEnd ?? value.length;
    const token = `{{${fieldName}}}`;
    setTpl(tpl.id, { [active]: value.slice(0, s) + token + value.slice(e) });
    requestAnimationFrame(() => {
      ta?.focus();
      ta?.setSelectionRange(s + token.length, s + token.length);
    });
  };

  const save = async () => {
    setError(null);
    setSaving(true);
    try {
      await content.updateNoteType(noteTypeId, {
        name: name.trim(),
        fields: def.fields,
        templates: def.templates,
        css: def.css,
      });
      notify.show(t('notes.types.saved'));
      navigate('/note-types');
    } catch (e) {
      const api = e as { code?: string; errors?: { message?: string }[] };
      setError(
        api.code === 'invalid_note_type' && api.errors?.length
          ? api.errors.map((x) => x.message).join(' ')
          : describeApiError(t, e),
      );
    } finally {
      setSaving(false);
    }
  };

  const btn =
    'cursor-pointer rounded-xl border-2 border-border px-2 py-1 text-xs font-extrabold text-text-muted hover:bg-surface disabled:opacity-40';

  return (
    <section className="flex min-w-0 flex-col gap-5 py-4">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <Link to="/note-types" className="text-xs font-extrabold text-secondary underline">
            {t('notes.types.back')}
          </Link>
          <h1 className="truncate text-[32px] font-extrabold leading-tight text-text">
            {t('notes.types.editTitle')}
          </h1>
        </div>
        <ChunkyButton
          disabled={saving || errors.length > 0 || !name.trim() || !net.online}
          title={net.message ?? undefined}
          onClick={() => void save()}
        >
          {t('cards.save')}
        </ChunkyButton>
      </div>

      {errors.length > 0 && (
        <ul
          role="alert"
          aria-label={t('notes.types.validation')}
          className="list-disc rounded-xl border-2 border-danger bg-danger-tint p-3 pl-7 text-sm font-bold text-text"
        >
          {errors.map((m, i) => (
            <li key={i}>{m}</li>
          ))}
        </ul>
      )}
      {error && (
        <p
          role="alert"
          className="rounded-xl border-2 border-danger bg-danger-tint p-3 text-sm font-bold text-text"
        >
          {error}
        </p>
      )}

      <div className="flex flex-col gap-1.5">
        <label htmlFor="nt-name" className={labelClass}>
          {t('notes.types.name')}
        </label>
        <input
          id="nt-name"
          className={`${inputClass} min-h-12`}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>

      <div className="flex flex-col gap-2">
        <h2 className={labelClass}>{t('notes.types.fields')}</h2>
        {def.fields.map((f, i) => (
          <div key={f.id} className="flex items-center gap-2">
            <input
              aria-label={t('notes.types.fieldName', { n: i + 1 })}
              className={inputClass}
              value={f.name}
              onChange={(e) => renameField(f.id, e.target.value)}
            />
            <button
              type="button"
              className={btn}
              aria-label={t('notes.types.moveUp')}
              disabled={i === 0}
              onClick={() => moveField(i, -1)}
            >
              ↑
            </button>
            <button
              type="button"
              className={btn}
              aria-label={t('notes.types.moveDown')}
              disabled={i === def.fields.length - 1}
              onClick={() => moveField(i, 1)}
            >
              ↓
            </button>
            <button
              type="button"
              className={btn}
              aria-label={t('notes.types.deleteField')}
              disabled={def.fields.length <= 1}
              onClick={() => setDropField(f.id)}
            >
              ✕
            </button>
          </div>
        ))}
        <div>
          <ChunkyButton size="sm" variant="outline" onClick={addField}>
            {t('notes.types.addField')}
          </ChunkyButton>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <h2 className={labelClass}>{t('notes.types.templates')}</h2>
        <div role="tablist" className="flex flex-wrap items-center gap-2">
          {def.templates.map((x) => (
            <button
              key={x.id}
              type="button"
              role="tab"
              aria-selected={x.id === tpl.id}
              onClick={() => setTplId(x.id)}
              className="cursor-pointer rounded-xl border-2 border-border px-3 py-1.5 text-xs font-extrabold text-text-muted aria-selected:border-nav-active-border aria-selected:bg-nav-active-bg aria-selected:text-nav-active-text"
            >
              {x.name || '—'}
            </button>
          ))}
          <ChunkyButton size="sm" variant="outline" onClick={addTemplate}>
            {t('notes.types.addTemplate')}
          </ChunkyButton>
        </div>
        <div className="flex items-center gap-2">
          <input
            aria-label={t('notes.types.templateName')}
            className={inputClass}
            value={tpl.name}
            onChange={(e) => setTpl(tpl.id, { name: e.target.value })}
          />
          <button
            type="button"
            className={btn}
            aria-label={t('notes.types.deleteTemplate')}
            disabled={def.templates.length <= 1}
            onClick={() => setDropTpl(tpl.id)}
          >
            ✕
          </button>
        </div>
        <div className="w-full max-w-xs">
          <Select
            aria-label={t('notes.types.insertField')}
            value=""
            onChange={insertField}
            options={[
              { value: '', label: t('notes.types.insertField') },
              ...def.fields.filter((f) => f.name).map((f) => ({ value: f.name, label: f.name })),
            ]}
          />
        </div>
        <div className="grid items-start gap-6 lg:grid-cols-2">
          <div className="flex min-w-0 flex-col gap-3">
            {(['front', 'back'] as const).map((side) => (
              <div key={side} className="flex flex-col gap-1.5">
                <label htmlFor={`tpl-${side}`} className={labelClass}>
                  {t(side === 'front' ? 'notes.types.frontTemplate' : 'notes.types.backTemplate')}
                </label>
                <textarea
                  ref={areas[side]}
                  id={`tpl-${side}`}
                  className={areaClass}
                  value={tpl[side]}
                  onFocus={() => setActive(side)}
                  onChange={(e) => setTpl(tpl.id, { [side]: e.target.value })}
                />
              </div>
            ))}
            <div className="flex flex-col gap-1.5">
              <label htmlFor="tpl-css" className={labelClass}>
                {t('notes.types.css')}
              </label>
              <textarea
                id="tpl-css"
                className={areaClass}
                value={def.css}
                onChange={(e) => patch((d) => ({ ...d, css: e.target.value }))}
              />
            </div>
          </div>
          <div className="flex min-w-0 flex-col gap-2">
            <h2 className={labelClass}>{t('ui.cards.livePreview')}</h2>
            {preview && (
              <div
                aria-label={t('ui.cards.livePreview')}
                className="flex flex-col gap-3 rounded-3xl border-2 border-border bg-[var(--color-card)] p-6"
              >
                <p className={labelClass}>{t('cards.front')}</p>
                <CardHtml html={preview.front} css={def.css} />
                <p className={labelClass}>{t('cards.back')}</p>
                <CardHtml html={preview.back} css={def.css} />
              </div>
            )}
          </div>
        </div>
      </div>

      <Dialog
        open={!!dropField}
        title={t('notes.types.deleteField')}
        onClose={() => setDropField(null)}
      >
        <p className="mb-4 text-sm font-semibold text-text-muted">
          {t('notes.types.deleteFieldConfirm')}
        </p>
        <div className="flex justify-end gap-3">
          <ChunkyButton variant="outline" onClick={() => setDropField(null)}>
            {t('cards.close')}
          </ChunkyButton>
          <ChunkyButton
            variant="danger"
            onClick={() => {
              patch((d) => ({ ...d, fields: d.fields.filter((f) => f.id !== dropField) }));
              setDropField(null);
            }}
          >
            {t('cards.delete')}
          </ChunkyButton>
        </div>
      </Dialog>
      <Dialog
        open={!!dropTpl}
        title={t('notes.types.deleteTemplate')}
        onClose={() => setDropTpl(null)}
      >
        <p className="mb-4 text-sm font-semibold text-text-muted">
          {t('notes.types.deleteTemplateConfirm')}
        </p>
        <div className="flex justify-end gap-3">
          <ChunkyButton variant="outline" onClick={() => setDropTpl(null)}>
            {t('cards.close')}
          </ChunkyButton>
          <ChunkyButton
            variant="danger"
            onClick={() => {
              patch((d) => ({ ...d, templates: d.templates.filter((x) => x.id !== dropTpl) }));
              setTplId('');
              setDropTpl(null);
            }}
          >
            {t('cards.delete')}
          </ChunkyButton>
        </div>
      </Dialog>
    </section>
  );
}
