// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { normaliseFront } from '@anki-duo/domain';
import {
  ImportParseError,
  defaultMapping,
  duplicateGroups,
  mapRows,
  parseImportFile,
} from '../../src/client/import/parse';

const dir = resolve(import.meta.dirname, '../../../../packages/fixtures/import');
const bytes = (f: string) => new Uint8Array(readFileSync(resolve(dir, f)));
interface Expected {
  error?: string;
  delimiter: string;
  hasHeader: boolean;
  columns: string[];
  dataRows: number;
  valid?: number;
  invalid: { row: number; reason: string }[];
  firstRow?: Record<string, unknown>;
  rows?: { row: number; front: string; back: string; tags: string[] }[];
  duplicateKeys?: Record<string, number[]>;
}
const expected = JSON.parse(readFileSync(resolve(dir, 'expected.json'), 'utf8')) as {
  files: Record<string, Expected>;
  limits: { maxBytes: number; maxRows: number };
};

const codeOf = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return e instanceof ImportParseError ? e.code : String(e);
  }
  return null;
};

describe('parseImportFile against expected.json', () => {
  for (const [file, exp] of Object.entries(expected.files)) {
    if (exp.error) {
      it(`${file}: rejected with ${exp.error}`, () => {
        expect(codeOf(() => parseImportFile(bytes(file)))).toBe(exp.error);
      });
      continue;
    }
    it(`${file}: delimiter, header, columns and row count`, () => {
      const parsed = parseImportFile(bytes(file));
      expect(parsed.delimiter).toBe(exp.delimiter);
      expect(parsed.hasHeader).toBe(exp.hasHeader);
      expect(parsed.columns).toEqual(exp.columns);
      expect(parsed.rows).toHaveLength(exp.dataRows);
    });

    it(`${file}: row validation and mapping`, () => {
      const parsed = parseImportFile(bytes(file));
      const res = mapRows(parsed, defaultMapping(parsed.columns, parsed.hasHeader));
      expect(res.invalid).toEqual(exp.invalid);
      if (exp.valid !== undefined) expect(res.valid).toHaveLength(exp.valid);
      if (exp.firstRow) expect(res.valid[0]).toMatchObject(exp.firstRow);
      for (const r of exp.rows ?? []) {
        expect(res.valid.find((v) => v.row === r.row)).toMatchObject({
          front: r.front,
          back: r.back,
          tags: r.tags,
        });
      }
    });
  }

  it('dupes.csv: finds the groups of duplicate fronts, NFC-insensitively', () => {
    const parsed = parseImportFile(bytes('dupes.csv'));
    const { valid } = mapRows(parsed, defaultMapping(parsed.columns, parsed.hasHeader));
    expect(duplicateGroups(valid)).toEqual(expected.files['dupes.csv']!.duplicateKeys);
    expect(Object.keys(duplicateGroups(valid)).every((k) => k === normaliseFront(k))).toBe(true);
  });
});

describe('parsing rules', () => {
  const enc = (s: string) => new TextEncoder().encode(s);

  it('handles UTF-8 with and without a BOM identically', () => {
    const plain = parseImportFile(enc('front,back\na,b\n'));
    const bom = parseImportFile(new Uint8Array([0xef, 0xbb, 0xbf, ...enc('front,back\na,b\n')]));
    expect(bom.columns).toEqual(plain.columns);
    expect(bom.columns[0]).toBe('front');
  });

  it.each([
    [',', 'a,b'],
    [';', 'a;b'],
    ['\t', 'a\tb'],
    ['|', 'a|b'],
  ])('detects the delimiter %j', (d, line) => {
    expect(parseImportFile(enc(`${line}\n${line}\n`)).delimiter).toBe(d);
  });

  it('a delimiter inside quotes does not count', () => {
    const p = parseImportFile(enc('"a;b;c",d\n"e;f",g\n'));
    expect(p.delimiter).toBe(',');
    expect(p.rows[0]!.cells).toEqual(['a;b;c', 'd']);
  });

  it.each(['front', 'Back', 'TAGS', 'Question', 'answer', 'Mặt trước', 'MẶT SAU', 'thẻ'])(
    'recognises the header name %s',
    (name) => {
      expect(parseImportFile(enc(`${name},zzz\nx,y\n`)).hasHeader).toBe(true);
    },
  );

  it('does not treat ordinary data as a header, and honours overrides', () => {
    const data = enc('hello,world\nfoo,bar\n');
    const p = parseImportFile(data);
    expect(p.hasHeader).toBe(false);
    expect(p.rows).toHaveLength(2);
    expect(parseImportFile(data, { hasHeader: true }).rows).toHaveLength(1);
    expect(
      parseImportFile(enc('a;b,c\nd;e,f\n'), { delimiter: ',', hasHeader: true }).columns,
    ).toEqual(['a;b', 'c']);
  });

  it('numbers lines from the source file, counting multi-line quoted cells', () => {
    const p = parseImportFile(enc('front,back\n"one\ntwo",x\nthree,y\n'));
    expect(p.rows.map((r) => r.line)).toEqual([2, 4]);
  });

  it('skips blank lines but still counts them', () => {
    const p = parseImportFile(enc('front,back\n\nlater,x\n'));
    expect(p.rows.map((r) => r.line)).toEqual([3]);
  });

  it('maps by header names and lets the learner choose columns', () => {
    const p = parseImportFile(enc('Answer,Question,Thẻ\nA1,Q1,t1 t2\n'));
    expect(defaultMapping(p.columns, p.hasHeader)).toEqual({ front: 1, back: 0, tags: 2 });
    const swapped = mapRows(p, { front: 0, back: 1 });
    expect(swapped.valid[0]).toMatchObject({ front: 'A1', back: 'Q1', tags: [] });
  });

  it('splits tags on whitespace or semicolons', () => {
    const p = parseImportFile(enc('front,back,tags\nq,a,"x;y z"\n'));
    expect(mapRows(p, defaultMapping(p.columns, p.hasHeader)).valid[0]!.tags).toEqual([
      'x',
      'y',
      'z',
    ]);
  });

  it('flags over-long fronts as invalid rows', () => {
    const p = parseImportFile(enc(`front,back\n${'a'.repeat(10_001)},b\n`));
    expect(mapRows(p, { front: 0, back: 1 }).invalid).toEqual([
      { row: 2, reason: 'front_too_long' },
    ]);
  });
});

describe('limits', () => {
  it('rejects more than 10 MB before parsing', () => {
    expect(codeOf(() => parseImportFile(new Uint8Array(expected.limits.maxBytes + 1)))).toBe(
      'import_too_large',
    );
  });

  it('rejects more than 10,000 data rows, accepts exactly 10,000', () => {
    const rows = (n: number) => new TextEncoder().encode('front,back\n' + 'a,b\n'.repeat(n));
    expect(parseImportFile(rows(10_000)).rows).toHaveLength(10_000);
    expect(codeOf(() => parseImportFile(rows(10_001)))).toBe('import_too_large');
  });

  it('rejects invalid UTF-8 as import_bad_encoding', () => {
    expect(codeOf(() => parseImportFile(new Uint8Array([0x66, 0xe9, 0x2c, 0x62])))).toBe(
      'import_bad_encoding',
    );
  });
});
