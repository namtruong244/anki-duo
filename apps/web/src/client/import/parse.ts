import Papa from 'papaparse';
import { normaliseFront, splitTags, validateRow, type RowReason } from '@anki-duo/domain';

export const MAX_BYTES = 10 * 1024 * 1024;
export const MAX_ROWS = 10_000;
export const DELIMITERS = [',', ';', '\t', '|'] as const;
export type Delimiter = (typeof DELIMITERS)[number];

export type ParseErrorCode =
  'import_bad_encoding' | 'import_too_large' | 'single_column' | 'empty_file';

/** The file cannot be imported at all; nothing is sent to the API (contracts/csv-import.md). */
export class ImportParseError extends Error {
  constructor(readonly code: ParseErrorCode) {
    super(code);
    this.name = 'ImportParseError';
  }
}

export interface ParsedRow {
  /** 1-based line in the source file where the row starts (the header is line 1). */
  line: number;
  cells: string[];
}

export interface ParsedFile {
  delimiter: Delimiter;
  hasHeader: boolean;
  columns: string[];
  rows: ParsedRow[];
}

export interface Mapping {
  front: number;
  back?: number | null;
  tags?: number | null;
}

export interface ImportRow {
  row: number;
  front: string;
  back: string;
  tags: string[];
}

export interface MappedRows {
  valid: ImportRow[];
  invalid: { row: number; reason: RowReason }[];
}

const FRONT_NAMES = ['front', 'question', 'mat truoc'];
const BACK_NAMES = ['back', 'answer', 'mat sau'];
const TAG_NAMES = ['tags', 'the'];

/** Case- and diacritic-insensitive: "Mặt trước" == "mat truoc". */
const nameKey = (s: string) =>
  s.normalize('NFD').replace(/\p{M}/gu, '').replace(/đ/gi, 'd').trim().toLowerCase();

const isHeaderName = (cell: string) =>
  [...FRONT_NAMES, ...BACK_NAMES, ...TAG_NAMES].includes(nameKey(cell));

function decode(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes); // strips a BOM
  } catch {
    throw new ImportParseError('import_bad_encoding');
  }
}

/** Picks the delimiter that splits the first lines into the most consistent columns. */
function detectDelimiter(text: string): Delimiter {
  let best: Delimiter = ',';
  let bestScore = 0;
  for (const d of DELIMITERS) {
    const rows = Papa.parse<string[]>(text, {
      delimiter: d,
      preview: 10,
      skipEmptyLines: 'greedy',
    }).data;
    const width = rows[0]?.length ?? 0;
    const score = width > 1 ? rows.filter((r) => r.length === width).length * 1000 + width : 0;
    if (score > bestScore) {
      best = d;
      bestScore = score;
    }
  }
  return best;
}

function splitRows(text: string, delimiter: Delimiter): ParsedRow[] {
  const rows: ParsedRow[] = [];
  let prev = 0;
  Papa.parse<string[]>(text, {
    delimiter,
    skipEmptyLines: 'greedy',
    step: (result) => {
      // Rows are numbered by where they start; blank lines before them still count as lines.
      const gap = /^(?:[ \t]*\r?\n)+/.exec(text.slice(prev));
      const start = prev + (gap ? gap[0].length : 0);
      let line = 1;
      for (let i = text.indexOf('\n'); i !== -1 && i < start; i = text.indexOf('\n', i + 1)) line++;
      rows.push({ line, cells: result.data });
      prev = result.meta.cursor;
    },
  });
  return rows;
}

export function parseImportFile(
  bytes: Uint8Array,
  overrides: { delimiter?: Delimiter; hasHeader?: boolean } = {},
): ParsedFile {
  if (bytes.byteLength > MAX_BYTES) throw new ImportParseError('import_too_large');
  const text = decode(bytes);
  if (text.trim() === '') throw new ImportParseError('empty_file');

  const delimiter = overrides.delimiter ?? detectDelimiter(text);
  const all = splitRows(text, delimiter);
  const first = all[0];
  if (!first) throw new ImportParseError('empty_file');
  if (first.cells.length < 2) throw new ImportParseError('single_column');

  const hasHeader = overrides.hasHeader ?? first.cells.some(isHeaderName);
  const rows = hasHeader ? all.slice(1) : all;
  if (rows.length > MAX_ROWS) throw new ImportParseError('import_too_large');
  const columns = hasHeader ? first.cells : first.cells.map((_, i) => `#${i + 1}`);
  return { delimiter, hasHeader, columns, rows };
}

/** Header names pick the columns; without a header it is Front, Back, Tags in file order. */
export function defaultMapping(columns: string[], hasHeader: boolean): Mapping {
  if (hasHeader) {
    const find = (names: string[]) => {
      const i = columns.findIndex((c) => names.includes(nameKey(c)));
      return i === -1 ? null : i;
    };
    return { front: find(FRONT_NAMES) ?? 0, back: find(BACK_NAMES), tags: find(TAG_NAMES) };
  }
  return { front: 0, back: columns.length > 1 ? 1 : null, tags: columns.length > 2 ? 2 : null };
}

/** Applies the mapping and the per-row rules; invalid rows carry their source line number. */
export function mapRows(parsed: ParsedFile, mapping: Mapping): MappedRows {
  const width = parsed.columns.length;
  const out: MappedRows = { valid: [], invalid: [] };
  for (const { line, cells } of parsed.rows) {
    if (cells.length !== width) {
      out.invalid.push({ row: line, reason: 'malformed_row' });
      continue;
    }
    const cell = (i: number | null | undefined) => (i == null ? '' : (cells[i] ?? ''));
    const checked = validateRow({
      front: cell(mapping.front),
      back: cell(mapping.back),
      tags: splitTags(cell(mapping.tags)),
    });
    if (checked.ok) out.valid.push({ row: line, ...checked.value });
    else out.invalid.push({ row: line, reason: checked.reason });
  }
  return out;
}

/** Normalised fronts shared by two or more rows, with their line numbers (preview estimate). */
export function duplicateGroups(rows: { row: number; front: string }[]): Record<string, number[]> {
  const groups = new Map<string, number[]>();
  for (const r of rows) {
    const key = normaliseFront(r.front);
    groups.set(key, [...(groups.get(key) ?? []), r.row]);
  }
  return Object.fromEntries([...groups].filter(([, v]) => v.length > 1));
}
