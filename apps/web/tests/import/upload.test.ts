import { describe, expect, it, vi } from 'vitest';
import { CHUNK_SIZE, planChunks, reportCsv, runImport } from '../../src/client/import/upload';

const rows = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    row: i + 2,
    front: `f${i}`,
    back: '',
    tags: [] as string[],
  }));

describe('planChunks', () => {
  it('splits into chunks of at most 1,000 rows', () => {
    expect(CHUNK_SIZE).toBe(1000);
    expect(planChunks(rows(2500)).map((c) => c.length)).toEqual([1000, 1000, 500]);
    expect(planChunks(rows(1000)).map((c) => c.length)).toEqual([1000]);
    expect(planChunks([])).toEqual([]);
  });
});

describe('runImport', () => {
  it('sends sequential chunks with one jobId, isLast on the final one, and reports progress', async () => {
    const post = vi
      .fn()
      .mockResolvedValueOnce({ data: { imported: 1000, updated: 0, skipped: 0, errors: [] } })
      .mockResolvedValueOnce({ data: { imported: 1500, updated: 0, skipped: 0, errors: [] } });
    const progress = vi.fn();
    const out = await runImport(
      { POST: post } as never,
      { deckId: 'd1', fileName: 'f.csv', jobId: 'job', mode: 'skip', rows: rows(1500) },
      progress,
    );
    const bodies = post.mock.calls.map((c) => c[1].body);
    expect(
      bodies.map((b) => [b.jobId, b.chunkIndex, b.isLast, b.totalRows, b.rows.length]),
    ).toEqual([
      ['job', 0, false, 1500, 1000],
      ['job', 1, true, 1500, 500],
    ]);
    expect(post.mock.calls[0]![0]).toBe('/decks/{deckId}/import');
    expect(post.mock.calls[0]![1].params).toEqual({ path: { deckId: 'd1' } });
    expect(progress).toHaveBeenLastCalledWith(1500, 1500);
    expect(out).toMatchObject({ imported: 1500 });
  });
});

describe('reportCsv', () => {
  it('writes line and reason, quoting when needed', () => {
    const csv = reportCsv(
      [
        { row: 3, reason: 'empty_front' },
        { row: 9, reason: 'dup, "x"' },
      ],
      (r) => r,
      ['Line', 'Reason'],
    );
    expect(csv).toBe('Line,Reason\n3,empty_front\n9,"dup, ""x"""\n');
  });
});
