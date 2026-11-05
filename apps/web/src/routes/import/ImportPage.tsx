import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { useTranslation } from 'react-i18next';
import { normaliseFront } from '@anki-duo/domain';
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
import { CardContent } from '../../components/session/CardContent';
import { ChunkyButton, ProgressBar } from '../../components/ui';
import { downloadText } from '../../lib/download';

type Mode = 'skip' | 'update' | 'keep_both';
const DELIMITER_KEY: Record<Delimiter, string> = {
  ',': 'comma',
  ';': 'semicolon',
  '\t': 'tab',
  '|': 'pipe',
};

/** File pick → delimiter/header/mapping → preview → duplicate mode → chunked upload → report. */
export function ImportPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { deckId = '' } = useParams();
  const net = useOnlineOnly();

  const [file, setFile] = useState<{ name: string; bytes: Uint8Array } | null>(null);
  const [parsed, setParsed] = useState<ParsedFile | null>(null);
  const [mapping, setMapping] = useState<Mapping>({ front: 0 });
  const [mode, setMode] = useState<Mode>('skip');
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<ImportTotals | null>(null);

  const existing = useLiveQuery(
    async () => (await dexieStore.listCards(deckId)).map((c) => normaliseFront(c.front)),
    [deckId],
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
    await parse(bytes);
  };

  const start = async () => {
    if (!mapped || !file) return;
    setError(null);
    setProgress({ done: 0, total: mapped.valid.length });
    try {
      const totals = await runImport(
        api,
        { deckId, fileName: file.name, jobId: newId(), mode, rows: mapped.valid },
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

  const columnOptions = (optional: boolean) => (
    <>
      {optional && <option value="">{t('import.mapNone')}</option>}
      {parsed?.columns.map((c, i) => (
        <option key={i} value={i}>
          {c}
        </option>
      ))}
    </>
  );
  const select = (label: string, key: keyof Mapping, optional: boolean) => (
    <label className="flex flex-col gap-1">
      {label}
      <select
        className="min-h-11 rounded-lg border border-border px-3"
        value={mapping[key] ?? ''}
        onChange={(e) =>
          setMapping({ ...mapping, [key]: e.target.value === '' ? null : Number(e.target.value) })
        }
      >
        {columnOptions(optional)}
      </select>
    </label>
  );

  if (result) {
    return (
      <section className="py-4" aria-live="polite">
        <h1 className="mb-4 text-2xl font-bold">{t('import.done')}</h1>
        <p>
          {t('import.imported')}: <strong>{result.imported}</strong> · {t('import.updated')}:{' '}
          <strong>{result.updated}</strong> · {t('import.skipped')}:{' '}
          <strong>{result.skipped}</strong>
        </p>
        {result.errors.length > 0 && (
          <>
            <h2 className="mt-4 mb-2 font-bold">{t('import.skippedRows')}</h2>
            <div className="max-h-80 overflow-auto">
              <table className="w-full text-left">
                <thead>
                  <tr>
                    <th>{t('import.line')}</th>
                    <th>{t('import.reason')}</th>
                  </tr>
                </thead>
                <tbody>
                  {result.errors.map((e, i) => (
                    <tr key={i}>
                      <td>{e.row}</td>
                      <td>{t(`import.reasons.${e.reason}`, { defaultValue: e.reason })}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ChunkyButton
              className="mt-3"
              variant="neutral"
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
              {t('import.downloadReport')}
            </ChunkyButton>
          </>
        )}
        <div className="mt-4 flex gap-2">
          <ChunkyButton
            variant="neutral"
            onClick={() => {
              setResult(null);
              setParsed(null);
              setFile(null);
            }}
          >
            {t('import.another')}
          </ChunkyButton>
          <ChunkyButton onClick={() => navigate('/decks')}>{t('import.backToDecks')}</ChunkyButton>
        </div>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-4 py-4">
      <h1 className="text-2xl font-bold">{t('import.title')}</h1>
      {net.message && (
        <p role="status" className="text-text-muted">
          {net.message}
        </p>
      )}
      <label className="flex flex-col gap-1 font-bold">
        {t('import.choose')}
        <input
          type="file"
          accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values,text/plain"
          data-testid="import-file"
          disabled={!net.online}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void choose(f);
          }}
        />
        <span className="text-sm font-normal text-text-muted">{t('import.hint')}</span>
      </label>
      {error && (
        <p role="alert" className="text-danger">
          {error}
        </p>
      )}

      {parsed && mapped && file && (
        <>
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1">
              {t('import.delimiter')}
              <select
                className="min-h-11 rounded-lg border border-border px-3"
                value={parsed.delimiter}
                onChange={(e) =>
                  void parse(file.bytes, {
                    delimiter: e.target.value as Delimiter,
                    hasHeader: parsed.hasHeader,
                  })
                }
              >
                {DELIMITERS.map((d) => (
                  <option key={d} value={d}>
                    {t(`import.delimiters.${DELIMITER_KEY[d]}`)}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex min-h-11 items-center gap-2">
              <input
                type="checkbox"
                checked={parsed.hasHeader}
                onChange={(e) =>
                  void parse(file.bytes, {
                    delimiter: parsed.delimiter,
                    hasHeader: e.target.checked,
                  })
                }
              />
              {t('import.headerRow')}
            </label>
          </div>

          <fieldset className="flex flex-wrap gap-3">
            <legend className="mb-1 font-bold">{t('import.mapping')}</legend>
            {select(t('import.mapFront'), 'front', false)}
            {select(t('import.mapBack'), 'back', true)}
            {select(t('import.mapTags'), 'tags', true)}
          </fieldset>

          <div>
            <h2 className="mb-1 font-bold">{t('import.previewTitle')}</h2>
            <p className="text-text-muted">
              {t('import.totalRows', { n: parsed.rows.length })} ·{' '}
              {t('import.invalidRows', { n: mapped.invalid.length })} ·{' '}
              {t('import.duplicateEstimate', { n: duplicates })}
            </p>
            <ul className="mt-2 flex flex-col gap-2">
              {mapped.valid.slice(0, 10).map((r) => (
                <li
                  key={r.row}
                  className="rounded-[var(--radius-card)] border border-border bg-surface p-3"
                >
                  <CardContent markdown={r.front} className="font-bold" />
                  <CardContent markdown={r.back} className="text-text-muted" />
                </li>
              ))}
            </ul>
          </div>

          <fieldset className="flex flex-col gap-1">
            <legend className="mb-1 font-bold">{t('import.duplicates')}</legend>
            {(['skip', 'update', 'keep_both'] as const).map((m) => (
              <label key={m} className="flex min-h-11 items-center gap-2">
                <input type="radio" name="mode" checked={mode === m} onChange={() => setMode(m)} />
                {t(`import.mode.${m}`)}
              </label>
            ))}
          </fieldset>

          {progress ? (
            <ProgressBar
              value={progress.done}
              max={progress.total}
              label={t('import.progress', progress)}
            />
          ) : (
            <ChunkyButton
              onClick={() => void start()}
              disabled={!net.online || mapped.valid.length === 0}
            >
              {t('import.start')}
            </ChunkyButton>
          )}
          {progress && <p role="status">{t('import.progress', progress)}</p>}
        </>
      )}
    </section>
  );
}
