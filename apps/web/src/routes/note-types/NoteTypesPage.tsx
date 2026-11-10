import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { content } from '../../client/runtime';
import type { NoteType } from '../../client/local-store';
import { useOnlineOnly } from '../../client/online-only';
import { notify } from '../../client/notify';
import { describeApiError } from '../../lib/api-error';
import { ChunkyButton, Dialog, Select } from '../../components/ui';

const fieldClass =
  'min-h-12 w-full rounded-2xl border-2 border-border bg-surface px-4 text-sm font-semibold text-text focus:border-secondary focus:outline-none';

/** Lists note types: add (clone), rename, delete; opens the editor for fields and templates. */
export function NoteTypesPage() {
  const { t } = useTranslation();
  const net = useOnlineOnly();
  const navigate = useNavigate();
  const [types, setTypes] = useState<NoteType[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [source, setSource] = useState('');
  const [name, setName] = useState('');
  const [renaming, setRenaming] = useState<NoteType | null>(null);
  const [deleting, setDeleting] = useState<NoteType | null>(null);

  const load = useCallback(async () => {
    try {
      setTypes((await content.listNoteTypes()).sort((a, b) => a.name.localeCompare(b.name)));
    } catch (e) {
      setTypes([]);
      setError(describeApiError(t, e));
    }
  }, [t]);
  useEffect(() => void load(), [load]);

  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      await load();
      return true;
    } catch (e) {
      setError(describeApiError(t, e));
      return false;
    }
  };

  const openAdd = () => {
    const base = types?.find((x) => x.name === 'Basic') ?? types?.[0];
    setSource(base?.id ?? '');
    setName(base ? t('notes.types.copyName', { name: base.name }) : '');
    setAdding(true);
  };

  const create = async () => {
    const base = types?.find((x) => x.id === source);
    if (!base) return;
    const ok = await run(async () => {
      const created = await content.createNoteType({
        name: name.trim(),
        fields: base.fields,
        templates: base.templates,
        css: base.css,
      });
      setAdding(false);
      navigate(`/note-types/${created.id}`);
    });
    if (!ok) setAdding(false);
  };

  return (
    <section className="flex min-w-0 flex-col gap-5 py-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-[32px] font-extrabold leading-tight text-text">
          {t('notes.types.title')}
        </h1>
        <ChunkyButton variant="primary" onClick={openAdd} {...net.buttonProps}>
          {t('notes.types.add')}
        </ChunkyButton>
      </div>
      <p className="text-sm font-semibold text-text-muted">{t('notes.types.intro')}</p>
      {error && (
        <p
          role="alert"
          className="rounded-xl border-2 border-danger bg-danger-tint p-3 text-sm font-bold text-text"
        >
          {error}
        </p>
      )}
      {types === null ? (
        <p role="status" className="p-8 text-center font-bold text-text-muted">
          {t('common.loading')}
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {types.map((nt) => (
            <li
              key={nt.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border-2 border-border bg-[var(--color-card)] p-4"
            >
              <div className="min-w-0">
                <Link
                  to={`/note-types/${nt.id}`}
                  className="block truncate text-base font-extrabold text-text hover:underline"
                >
                  {nt.name}
                </Link>
                <p className="text-xs font-semibold text-text-muted">
                  {t('notes.types.summary', {
                    fields: nt.fields.length,
                    templates: nt.templates.length,
                  })}
                </p>
              </div>
              <div className="flex gap-2">
                <ChunkyButton
                  size="sm"
                  variant="outline"
                  onClick={() => navigate(`/note-types/${nt.id}`)}
                >
                  {t('cards.edit')}
                </ChunkyButton>
                <ChunkyButton
                  size="sm"
                  variant="outline"
                  disabled={!net.online}
                  onClick={() => setRenaming(nt)}
                >
                  {t('notes.types.rename')}
                </ChunkyButton>
                <ChunkyButton
                  size="sm"
                  variant="danger"
                  disabled={!net.online}
                  onClick={() => setDeleting(nt)}
                >
                  {t('cards.delete')}
                </ChunkyButton>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={adding} title={t('notes.types.add')} onClose={() => setAdding(false)}>
        <div className="flex flex-col gap-3">
          <label htmlFor="nt-source" className="text-xs font-extrabold text-text-muted">
            {t('notes.types.cloneFrom')}
          </label>
          <Select
            id="nt-source"
            value={source}
            onChange={(v) => {
              setSource(v);
              const b = types?.find((x) => x.id === v);
              if (b) setName(t('notes.types.copyName', { name: b.name }));
            }}
            options={(types ?? []).map((x) => ({ value: x.id, label: x.name }))}
          />
          <label htmlFor="nt-name" className="text-xs font-extrabold text-text-muted">
            {t('notes.types.name')}
          </label>
          <input
            id="nt-name"
            className={fieldClass}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <div className="flex justify-end gap-3">
            <ChunkyButton variant="outline" onClick={() => setAdding(false)}>
              {t('cards.close')}
            </ChunkyButton>
            <ChunkyButton disabled={!name.trim() || !source} onClick={() => void create()}>
              {t('notes.types.create')}
            </ChunkyButton>
          </div>
        </div>
      </Dialog>

      <Dialog open={!!renaming} title={t('notes.types.rename')} onClose={() => setRenaming(null)}>
        <div className="flex flex-col gap-3">
          <label htmlFor="nt-rename" className="text-xs font-extrabold text-text-muted">
            {t('notes.types.name')}
          </label>
          <input
            id="nt-rename"
            className={fieldClass}
            value={renaming?.name ?? ''}
            onChange={(e) => renaming && setRenaming({ ...renaming, name: e.target.value })}
          />
          <div className="flex justify-end gap-3">
            <ChunkyButton variant="outline" onClick={() => setRenaming(null)}>
              {t('cards.close')}
            </ChunkyButton>
            <ChunkyButton
              disabled={!renaming?.name.trim()}
              onClick={() => {
                const r = renaming!;
                setRenaming(null);
                void run(() => content.updateNoteType(r.id, { name: r.name.trim() }));
              }}
            >
              {t('cards.save')}
            </ChunkyButton>
          </div>
        </div>
      </Dialog>

      <Dialog
        open={!!deleting}
        title={t('notes.types.deleteTitle')}
        onClose={() => setDeleting(null)}
      >
        <p className="mb-4 text-sm font-semibold text-text-muted">
          {t('notes.types.deleteConfirm', { name: deleting?.name ?? '' })}
        </p>
        <div className="flex justify-end gap-3">
          <ChunkyButton variant="outline" onClick={() => setDeleting(null)}>
            {t('cards.close')}
          </ChunkyButton>
          <ChunkyButton
            variant="danger"
            onClick={() => {
              const d = deleting!;
              setDeleting(null);
              void run(async () => {
                await content.deleteNoteType(d.id);
                notify.show(t('notes.types.deleted'));
              });
            }}
          >
            {t('cards.delete')}
          </ChunkyButton>
        </div>
      </Dialog>
    </section>
  );
}
