import { useMemo, useState, type DragEvent } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { useTranslation } from 'react-i18next';
import { htmlToText, normaliseFront } from '@anki-duo/domain';
import { api } from '../../client/api';
import { newId, syncEngine } from '../../client/runtime';
import { dexieStore } from '../../client/store';
import { useOnlineOnly } from '../../client/online-only';
import {
  DELIMITERS,
  ImportParseError,
  defaultMapping,
  duplicateGroups,
  mapRows,
  type Delimiter,
  type Mapping,
  type ParsedFile,
} from '../../client/import/parse';
import { parseInWorker } from '../../client/import/parse-client';
import { reportCsv, runImport, type ImportTotals } from '../../client/import/upload';
import { ChunkyButton, Icon, ProgressBar, Select } from '../../components/ui';
import { downloadText } from '../../lib/download';

type Mode = 'skip' | 'update' | 'keep_both';
type Role = 'front' | 'back' | 'tags' | 'skip';
const DELIMITER_KEY: Record<Delimiter, string> = {
  ',': 'comma',
  ';': 'semicolon',
  '\t': 'tab',
  '|': 'pipe',
};
const ACCEPT = '.csv,.tsv,.txt,text/csv,text/tab-separated-values,text/plain';

const labelClass = 'text-[11px] font-extrabold uppercase tracking-[0.1em] text-text-muted';

function Stepper({ step }: { step: 1 | 2 | 3 | 4 }) {
  const { t } = useTranslation();
  const labels = [t('ui.import.stepChoose'), t('ui.import.stepMap'), t('ui.import.stepReview')];
  return (
    <ol className="flex items-center gap-2 sm:gap-3" aria-label={t('import.titleFull')}>
      {labels.map((label, i) => {
        const n = i + 1;
        const done = step > n;
        const current = step === n;
        return (
          <li key={n} className="flex min-w-0 flex-1 items-center gap-2 last:flex-none sm:gap-3">
            <span
              aria-current={current ? 'step' : undefined}
              className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-extrabold ${
                done
                  ? 'bg-primary text-on-primary'
                  : current
                    ? 'bg-secondary text-on-secondary'
                    : 'bg-neutral text-text-muted'
              }`}
            >
              {done ? <Icon name="check" size={18} /> : n}
            </span>
            <span
              className={`truncate text-sm font-extrabold ${current || done ? 'text-text' : 'text-text-muted'} ${current ? '' : 'hidden sm:inline'}`}
            >
              {label}
            </span>
            {n < 3 && (
              <span
                aria-hidden="true"
                className={`h-[3px] min-w-3 flex-1 rounded ${done ? 'bg-primary' : 'bg-neutral'}`}
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}

/** Pick file → map columns → preview & import (chunked upload) → report. */
export function ImportPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { deckId = '' } = useParams();
  const net = useOnlineOnly();

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [targetDeck, setTargetDeck] = useState(deckId);
  const [delimiter, setDelimiter] = useState<Delimiter | undefined>();
  const [dragging, setDragging] = useState(false);
  const [file, setFile] = useState<{ name: string; bytes: Uint8Array } | null>(null);
  const [parsed, setParsed] = useState<ParsedFile | null>(null);
  const [mapping, setMapping] = useState<Mapping>({ front: 0 });
  const [mode, setMode] = useState<Mode>('skip');
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<ImportTotals | null>(null);

  const decks = useLiveQuery(
    async () => (await dexieStore.listDecks()).sort((a, b) => a.name.localeCompare(b.name)),
    [],
  );
  const existing = useLiveQuery(
    async () =>
      (await dexieStore.listCards(targetDeck)).map((c) =>
        normaliseFront(c.format === 'html' ? htmlToText(c.front) : c.front),
      ),
    [targetDeck],
  );

  const mapped = useMemo(() => (parsed ? mapRows(parsed, mapping) : null), [parsed, mapping]);
  const duplicates = useMemo(() => {
    if (!mapped) return 0;
    // Estimate on the device: rows matching an existing card, plus repeats inside the file.
    const have = new Set(existing ?? []);
    const inFile = Object.values(duplicateGroups(mapped.valid)).reduce(
      (n, rows) => n + rows.length - 1,
      0,
    );
    const seen = new Set<string>();
    let matching = 0;
    for (const r of mapped.valid) {
      const key = normaliseFront(r.front);
      if (have.has(key) && !seen.has(key)) matching++;
      seen.add(key);
    }
    return matching + inFile;
  }, [mapped, existing]);

  const parse = async (
    bytes: Uint8Array,
    overrides: { delimiter?: Delimiter; hasHeader?: boolean } = {},
  ) => {
    setError(null);
    try {
      const p = await parseInWorker(bytes, overrides);
      setParsed(p);
      setMapping(defaultMapping(p.columns, p.hasHeader));
    } catch (e) {
      setParsed(null);
      setError(t(`import.errors.${e instanceof ImportParseError ? e.code : 'unknown'}`));
    }
  };

  const choose = async (f: File) => {
    const bytes = new Uint8Array(await f.arrayBuffer());
    setFile({ name: f.name, bytes });
    setResult(null);
    await parse(bytes, delimiter ? { delimiter } : {});
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files?.[0];
    if (f && net.online) void choose(f);
  };

  const start = async () => {
    if (!mapped || !file) return;
    setError(null);
    setProgress({ done: 0, total: mapped.valid.length });
    try {
      const totals = await runImport(
        api,
        { deckId: targetDeck, fileName: file.name, jobId: newId(), mode, rows: mapped.valid },
        (done, total) => setProgress({ done, total }),
      );
      // Rows rejected on the device are part of the same report.
      setResult({
        ...totals,
        skipped: totals.skipped + mapped.invalid.length,
        errors: [...mapped.invalid, ...totals.errors].sort((a, b) => a.row - b.row),
      });
      void syncEngine.syncNow();
    } catch {
      setError(t('import.errors.failed'));
    } finally {
      setProgress(null);
    }
  };

  const roleFor = (i: number): Role =>
    mapping.front === i
      ? 'front'
      : mapping.back === i
        ? 'back'
        : mapping.tags === i
          ? 'tags'
          : 'skip';

  const setRole = (i: number, role: Role) => {
    const next: Mapping = { ...mapping };
    if (next.back === i) next.back = null;
    if (next.tags === i) next.tags = null;
    if (role === 'front') {
      next.front = i;
    } else if (role === 'back') {
      next.back = i;
    } else if (role === 'tags') {
      next.tags = i;
    } else if (next.front === i) {
      // The front column is required: hand it to the first column still free.
      const fallback = parsed
        ? parsed.columns.findIndex((_, j) => j !== i && j !== next.back && j !== next.tags)
        : -1;
      if (fallback === -1) return;
      next.front = fallback;
    }
    setMapping(next);
  };

  const title = (
    <h1 className="text-[32px] font-extrabold leading-tight text-text">{t('import.titleFull')}</h1>
  );
  const netMessage = net.message && (
    <div
      role="status"
      className="rounded-xl border-2 border-border bg-surface p-3.5 text-sm font-bold text-text-muted"
    >
      {net.message}
    </div>
  );

  if (result) {
    return (
      <section
        className="mx-auto flex w-full max-w-[800px] min-w-0 flex-col gap-6"
        aria-live="polite"
      >
        {title}
        <Stepper step={4} />
        <div className="rounded-[var(--radius-card)] border-2 border-border bg-[var(--color-card)] p-6 text-center sm:p-8">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border-2 border-primary/40 bg-primary-tint text-text">
            <Icon name="check" size={32} />
          </div>
          <h2 className="text-2xl font-black text-text sm:text-3xl">{t('import.done')}</h2>
          {file && <p className="mt-1 text-sm font-bold text-text-muted">{file.name}</p>}

          <div className="my-6 grid grid-cols-1 gap-4 text-left sm:grid-cols-3">
            <div className="rounded-[var(--radius-card)] border-2 border-primary/40 bg-primary-tint p-4">
              <p className="text-sm font-bold text-text">
                {t('import.imported')}:{' '}
                <strong className="mt-1 block text-2xl font-black">{result.imported}</strong>
              </p>
            </div>
            <div className="rounded-[var(--radius-card)] border-2 border-secondary/40 bg-secondary-tint p-4">
              <p className="text-sm font-bold text-text">
                {t('import.updated')}:{' '}
                <strong className="mt-1 block text-2xl font-black">{result.updated}</strong>
              </p>
            </div>
            <div className="rounded-[var(--radius-card)] border-2 border-border bg-surface p-4">
              <p className="text-sm font-bold text-text">
                {t('import.skipped')}:{' '}
                <strong className="mt-1 block text-2xl font-black">{result.skipped}</strong>
              </p>
            </div>
          </div>

          {result.errors.length > 0 && (
            <div className="mt-6 text-left">
              <h3 className="mb-3 text-lg font-black text-text">{t('import.skippedRows')}</h3>
              <div className="max-h-80 overflow-auto rounded-[var(--radius-card)] border-2 border-border bg-surface">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b-2 border-border bg-surface-2 text-text-muted">
                      <th className="p-3 font-black">{t('import.line')}</th>
                      <th className="p-3 font-black">{t('import.reason')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.errors.map((e, i) => (
                      <tr key={i} className="border-b border-border/50 bg-[var(--color-card)]">
                        <td className="p-3 font-mono font-bold text-text">{e.row}</td>
                        <td className="p-3 font-semibold text-text-muted">
                          {t(`import.reasons.${e.reason}`, { defaultValue: e.reason })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <ChunkyButton
                className="mt-4"
                variant="outline"
                onClick={() =>
                  downloadText(
                    `${file?.name.replace(/\.[^.]+$/, '') ?? 'import'}-skipped.csv`,
                    reportCsv(result.errors, (r) => t(`import.reasons.${r}`, { defaultValue: r }), [
                      t('import.line'),
                      t('import.reason'),
                    ]),
                    'text/csv',
                  )
                }
              >
                <Icon name="file-spreadsheet" size={16} />
                <span>{t('import.downloadReport')}</span>
              </ChunkyButton>
            </div>
          )}

          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <ChunkyButton
              variant="outline"
              onClick={() => {
                setResult(null);
                setParsed(null);
                setFile(null);
                setStep(1);
              }}
            >
              {t('import.another')}
            </ChunkyButton>
            <ChunkyButton onClick={() => navigate('/cards')}>
              {t('import.backToDecks')}
            </ChunkyButton>
          </div>
        </div>
      </section>
    );
  }

  const activeDelimiter = delimiter ?? parsed?.delimiter ?? ',';
  const importCount = mapped
    ? mode === 'skip'
      ? Math.max(0, mapped.valid.length - duplicates)
      : mapped.valid.length
    : 0;

  return (
    <section className="mx-auto flex w-full max-w-[800px] min-w-0 flex-col gap-6">
      {title}
      <Stepper step={step} />
      {netMessage}

      {error && (
        <p
          role="alert"
          className="rounded-xl border-2 border-danger bg-danger-tint p-4 text-sm font-bold text-text"
        >
          {error}
        </p>
      )}

      {step === 1 && (
        <>
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            data-testid="import-dropzone"
            className={`flex min-h-64 flex-col items-center justify-center gap-3 rounded-3xl border-2 p-6 text-center transition-colors ${
              dragging
                ? 'border-dashed border-secondary bg-secondary-tint'
                : 'border-secondary/50 bg-surface'
            }`}
          >
            <Icon name="upload" size={48} className="text-secondary" />
            <p className="text-xl font-extrabold text-text">{t('ui.import.dropTitle')}</p>
            <p className="text-xs font-semibold text-text-muted">{t('import.hint')}</p>
            {file && (
              <p className="inline-flex max-w-full items-center gap-1.5 text-sm font-extrabold text-text">
                <Icon name="check" size={16} className="shrink-0 text-primary-accent" />
                <span className="truncate">{file.name}</span>
                {parsed && (
                  <span className="shrink-0 font-semibold text-text-muted">
                    · {t('import.totalRows', { n: parsed.rows.length })}
                  </span>
                )}
              </p>
            )}
            <label className="group">
              <span
                className={`inline-flex min-h-10 items-center justify-center rounded-[var(--radius-button)] bg-secondary px-4 py-2 text-[13px] font-extrabold uppercase tracking-[0.04em] text-on-secondary shadow-[0_var(--button-depth)_0_var(--color-secondary-depth)] group-has-[:focus-visible]:outline-3 group-has-[:focus-visible]:outline-focus ${
                  net.online
                    ? 'cursor-pointer hover:brightness-[1.03] transition-[transform,box-shadow,filter] duration-[var(--duration-fast)] active:translate-y-[var(--button-press-offset)] active:shadow-none'
                    : 'opacity-50'
                }`}
              >
                {t('ui.import.chooseBtn')}
              </span>
              <input
                type="file"
                accept={ACCEPT}
                data-testid="import-file"
                disabled={!net.online}
                className="sr-only"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = '';
                  if (f) void choose(f);
                }}
              />
            </label>
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="import-deck" className={labelClass}>
              {t('ui.import.targetDeck')}
            </label>
            <Select
              id="import-deck"
              value={targetDeck}
              onChange={(val) => setTargetDeck(val)}
              options={(decks ?? []).map((d) => ({ value: d.id, label: d.name }))}
            />
          </div>

          <div
            role="group"
            aria-labelledby="import-delim"
            className="flex flex-wrap items-center gap-3"
          >
            <span id="import-delim" className={labelClass}>
              {t('import.delimiter')}
            </span>
            {DELIMITERS.map((d) => {
              const active = activeDelimiter === d;
              return (
                <button
                  key={d}
                  type="button"
                  aria-pressed={active}
                  onClick={() => {
                    setDelimiter(d);
                    if (file) {
                      void parse(
                        file.bytes,
                        parsed ? { delimiter: d, hasHeader: parsed.hasHeader } : { delimiter: d },
                      );
                    }
                  }}
                  className={`min-h-9 cursor-pointer rounded-xl border-2 px-3.5 text-xs font-extrabold text-nav-active-text transition-[transform,background-color,border-color] duration-[var(--duration-fast)] active:scale-95 ${
                    active
                      ? 'border-nav-active-border bg-nav-active-bg'
                      : 'border-border bg-[var(--color-card)] hover:bg-surface'
                  }`}
                >
                  {t(`import.delimiters.${DELIMITER_KEY[d]}`)}
                </button>
              );
            })}
          </div>

          <div className="flex justify-end">
            <ChunkyButton disabled={!parsed || !targetDeck} onClick={() => setStep(2)}>
              {t('ui.import.continue')}
            </ChunkyButton>
          </div>
        </>
      )}

      {step === 2 && parsed && (
        <>
          <div className="flex flex-col gap-3 rounded-3xl border-2 border-border bg-[var(--color-card)] p-6">
            <h2 className="text-base font-extrabold text-text">{t('import.joinTitle')}</h2>
            <ul className="flex flex-col gap-3">
              {parsed.columns.map((col, i) => {
                const sample = parsed.rows[0]?.cells[i];
                const letter = String.fromCharCode(65 + i);
                return (
                  <li key={i} className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
                    <div className="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-2xl border-2 border-border bg-surface px-4">
                      <span className="shrink-0 text-[11px] font-extrabold uppercase tracking-wide text-nav-active-text">
                        {t('ui.import.column')} {letter}
                      </span>
                      <span className="truncate text-sm font-semibold text-text">
                        {sample || '—'}
                      </span>
                    </div>
                    <Icon
                      name="arrow-right"
                      size={20}
                      className="hidden shrink-0 text-text-muted sm:block"
                    />
                    <Select
                      aria-label={`${t('ui.import.column')} ${letter}: ${col}`}
                      variant="tint"
                      className="sm:w-60"
                      value={roleFor(i)}
                      onChange={(val) => setRole(i, val as Role)}
                      options={[
                        { value: 'front', label: t('import.mapFront') },
                        { value: 'back', label: t('import.mapBack') },
                        { value: 'tags', label: t('import.mapTags') },
                        { value: 'skip', label: t('ui.import.ignore') },
                      ]}
                    />
                  </li>
                );
              })}
            </ul>
            <label className="flex min-h-11 w-fit cursor-pointer items-center gap-3 text-sm font-semibold text-text">
              <input
                type="checkbox"
                className="h-6 w-6 rounded-md border-2 border-border accent-primary"
                checked={parsed.hasHeader}
                onChange={(e) =>
                  file &&
                  void parse(file.bytes, {
                    delimiter: parsed.delimiter,
                    hasHeader: e.target.checked,
                  })
                }
              />
              <span>{t('import.headerRow')}</span>
            </label>
          </div>
          <div className="flex justify-end gap-3">
            <ChunkyButton variant="outline" onClick={() => setStep(1)}>
              {t('import.back')}
            </ChunkyButton>
            <ChunkyButton onClick={() => setStep(3)}>{t('ui.import.continue')}</ChunkyButton>
          </div>
        </>
      )}

      {step === 3 && parsed && mapped && file && (
        <>
          <div className="overflow-x-auto rounded-3xl border-2 border-border bg-[var(--color-card)]">
            <table className="w-full min-w-[480px] text-left text-sm">
              <thead>
                <tr className="bg-surface text-[11px] font-extrabold uppercase tracking-[0.1em] text-text-muted">
                  <th className="px-4 py-3">{t('cards.front')}</th>
                  <th className="px-4 py-3">{t('cards.back')}</th>
                  <th className="px-4 py-3">{t('ui.import.tag')}</th>
                </tr>
              </thead>
              <tbody className="divide-y-2 divide-border border-t-2 border-border">
                {mapped.valid.slice(0, 5).map((r) => (
                  <tr key={r.row} className="font-semibold text-text">
                    <td className="max-w-48 truncate px-4 py-3">{r.front}</td>
                    <td className="max-w-48 truncate px-4 py-3">{r.back}</td>
                    <td className="px-4 py-3">{r.tags.map((x) => `#${x}`).join(' ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex flex-col gap-3 rounded-3xl border-2 border-border bg-[var(--color-card)] p-5">
            <p className="flex items-center gap-2 text-sm font-extrabold text-text">
              <Icon name="circle-check" size={24} className="text-primary" />
              <span>{t(`ui.import.summary.${mode}`, { n: importCount, dup: duplicates })}</span>
            </p>
            {mapped.invalid.length > 0 && (
              <p className="text-xs font-bold text-danger-depth">
                {t('import.invalidRows', { n: mapped.invalid.length })}
              </p>
            )}
            {progress && (
              <div className="flex flex-col gap-1">
                <ProgressBar
                  value={progress.done}
                  max={progress.total}
                  label={t('import.progress', progress)}
                />
                <p role="status" className="text-xs font-bold text-text-muted">
                  {t('import.progress', progress)}
                </p>
              </div>
            )}
            <fieldset className="flex flex-wrap items-center gap-2" disabled={!!progress}>
              <legend className="sr-only">{t('import.duplicates')}</legend>
              <span aria-hidden="true" className={labelClass}>
                {t('import.duplicates')}
              </span>
              {(['skip', 'update', 'keep_both'] as const).map((m) => (
                <label
                  key={m}
                  className={`flex min-h-9 cursor-pointer items-center gap-2 rounded-xl border-2 px-3 text-xs font-extrabold transition-[transform,background-color,border-color] duration-[var(--duration-fast)] active:scale-95 ${
                    mode === m
                      ? 'border-nav-active-border bg-nav-active-bg text-nav-active-text'
                      : 'border-border text-text-muted hover:bg-surface'
                  }`}
                >
                  <input
                    type="radio"
                    name="mode"
                    checked={mode === m}
                    onChange={() => setMode(m)}
                    className="accent-secondary"
                  />
                  <span>{t(`import.mode.${m}`)}</span>
                </label>
              ))}
            </fieldset>
          </div>

          <div className="flex justify-end gap-3">
            <ChunkyButton variant="outline" disabled={!!progress} onClick={() => setStep(2)}>
              {t('import.back')}
            </ChunkyButton>
            <ChunkyButton
              onClick={() => void start()}
              disabled={!net.online || mapped.valid.length === 0 || !!progress}
            >
              {t('import.importCount', { n: importCount })}
            </ChunkyButton>
          </div>
        </>
      )}
    </section>
  );
}
