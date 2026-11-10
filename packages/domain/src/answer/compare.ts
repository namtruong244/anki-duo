import { htmlToText } from '../notes/sanitize.js';
import type { Verdict } from '../notes/interaction.js';

export interface CompareOptions {
  ignoreCase: boolean;
  ignoreDiacritics: boolean;
}

/**
 * One run of the typed-vs-expected diff (R6, FR-034), in reading order.
 * - `equal`: same in both; `text` is what the learner typed;
 * - `wrong`: the learner typed `text` where `expected` belongs;
 * - `missing`: `text` is in the expected answer only;
 * - `extra`: `text` is in the typed answer only.
 */
export type DiffOp =
  | { op: 'equal' | 'missing' | 'extra'; text: string }
  | { op: 'wrong'; text: string; expected: string };

export interface CompareResult {
  verdict: Verdict;
  ops: DiffOp[];
}

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

function graphemes(s: string): string[] {
  return [...segmenter.segment(s)].map((g) => g.segment);
}

function collapse(s: string): string {
  return s.normalize('NFC').replace(/\s+/g, ' ').trim();
}

function fold(g: string, o: CompareOptions): string {
  let k = g;
  if (o.ignoreDiacritics)
    k = k
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
      .replace(/đ/g, 'd')
      .replace(/Đ/g, 'D');
  if (o.ignoreCase) k = k.toLowerCase();
  return k.normalize('NFC');
}

/**
 * The normal form used to compare two answers as strings (also by `buildChoices`): NFC, trim,
 * whitespace collapse, then the case and diacritics folds of `o`.
 */
export function normalizeAnswer(s: string, o: CompareOptions): string {
  return graphemes(collapse(s))
    .map((g) => fold(g, o))
    .join('');
}

function levenshtein(a: string[], b: string[]): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(
        prev[j]! + 1,
        cur[j - 1]! + 1,
        prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = cur;
  }
  return prev[b.length]!;
}

/** LCS alignment over the folded keys; `expected` and `given` are the display graphemes. */
function diff(ek: string[], gk: string[], eg: string[], gg: string[]): DiffOp[] {
  const n = ek.length;
  const m = gk.length;
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      lcs[i]![j] = ek[i] === gk[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
  const ops: DiffOp[] = [];
  let eq = '';
  let miss = '';
  let extra = '';
  const flushChange = (): void => {
    if (miss && extra) ops.push({ op: 'wrong', text: extra, expected: miss });
    else if (miss) ops.push({ op: 'missing', text: miss });
    else if (extra) ops.push({ op: 'extra', text: extra });
    miss = '';
    extra = '';
  };
  const flushEqual = (): void => {
    if (eq) ops.push({ op: 'equal', text: eq });
    eq = '';
  };
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && ek[i] === gk[j]) {
      flushChange();
      eq += gg[j];
      i++;
      j++;
    } else if (j < m && (i === n || lcs[i]![j + 1]! >= lcs[i + 1]![j]!)) {
      flushEqual();
      extra += gg[j];
      j++;
    } else {
      flushEqual();
      miss += eg[i];
      i++;
    }
  }
  flushChange();
  flushEqual();
  return ops;
}

/**
 * Checks a typed answer (R6). `expected` may contain html (it is reduced to text); `given` is
 * what the learner typed. Both are NFC-normalized, trimmed and whitespace-collapsed, then
 * compared by grapheme with the case and diacritics folds of `opts`.
 *
 * Verdict: equal is `correct`; exactly one edit for 5-11 expected graphemes, or at most two for
 * 12 or more, is `almost` (FR-035); everything else, and empty input, is `wrong`.
 */
export function compareTyped(expected: string, given: string, opts: CompareOptions): CompareResult {
  const eg = graphemes(collapse(htmlToText(expected)));
  const gg = graphemes(collapse(given));
  const ek = eg.map((g) => fold(g, opts));
  const gk = gg.map((g) => fold(g, opts));
  const ops = diff(ek, gk, eg, gg);
  if (gg.length === 0) return { verdict: 'wrong', ops };
  if (ek.join('') === gk.join('')) return { verdict: 'correct', ops };
  const len = ek.length;
  const dist = levenshtein(ek, gk);
  const almost = (len >= 5 && len <= 11 && dist <= 1) || (len >= 12 && dist <= 2);
  return { verdict: almost ? 'almost' : 'wrong', ops };
}
