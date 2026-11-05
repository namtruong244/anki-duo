import type { Api } from '../api';
import type { ImportRow } from './parse';

export const CHUNK_SIZE = 1000;

export function planChunks<T>(rows: T[], size = CHUNK_SIZE): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

export interface ImportTotals {
  imported: number;
  updated: number;
  skipped: number;
  errors: { row: number; reason: string }[];
}

/**
 * Uploads valid rows in order: chunks of ≤ 1,000 with one jobId and increasing chunkIndex, the last
 * flagged `isLast`. The server's totals are cumulative, so the last response is the result.
 * Re-running with the same jobId is safe (the server ignores chunks it already applied).
 */
export async function runImport(
  api: Pick<Api, 'POST'>,
  job: {
    deckId: string;
    fileName: string;
    jobId: string;
    mode: 'skip' | 'update' | 'keep_both';
    rows: ImportRow[];
  },
  onProgress: (done: number, total: number) => void = () => undefined,
): Promise<ImportTotals> {
  const chunks = planChunks(job.rows);
  let totals: ImportTotals = { imported: 0, updated: 0, skipped: 0, errors: [] };
  let sent = 0;
  for (const [i, rows] of chunks.entries()) {
    const { data } = await api.POST('/decks/{deckId}/import', {
      params: { path: { deckId: job.deckId } },
      body: {
        jobId: job.jobId,
        fileName: job.fileName,
        totalRows: job.rows.length,
        chunkIndex: i,
        isLast: i === chunks.length - 1,
        duplicateMode: job.mode,
        rows: rows.map((r) => ({ row: r.row, front: r.front, back: r.back, tags: r.tags })),
      },
    });
    totals = data!;
    sent += rows.length;
    onProgress(sent, job.rows.length);
  }
  return totals;
}

const csvCell = (s: string) => (/[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

/** The skipped-rows report as CSV; `reasonLabel` translates the reason code. */
export function reportCsv(
  errors: { row: number; reason: string }[],
  reasonLabel: (reason: string) => string,
  header: [string, string],
): string {
  const lines = [header.map(csvCell).join(',')];
  for (const e of errors) lines.push(`${e.row},${csvCell(reasonLabel(e.reason))}`);
  return lines.join('\n') + '\n';
}
