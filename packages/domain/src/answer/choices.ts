import { htmlToText } from '../notes/sanitize.js';
import { normalizeAnswer } from './compare.js';

const NORM = { ignoreCase: true, ignoreDiacritics: false } as const;
const MAX_LEN = 80;
const MAX_WRONG = 7;
const MAX_FROM_POOL = 3;

const tidy = (s: string): string => s.normalize('NFC').replace(/\s+/g, ' ').trim();
const length = (s: string): number => [...s].length;

/** Fisher-Yates on a copy; `rng` returns a number in [0, 1). */
function shuffle<T>(items: readonly T[], rng: () => number): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.min(i, Math.floor(rng() * (i + 1)));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

/**
 * Splits a "wrong answers" field (html) into trimmed answers on `<br>`, `<p>` (and other block
 * tags) and newlines, de-duplicated after normalization (case-insensitive). Empty lines are
 * dropped. Pure.
 */
export function splitWrongAnswers(html: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of htmlToText(html).split('\n')) {
    const t = tidy(line);
    const key = normalizeAnswer(t, NORM);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

/**
 * The options of one multiple-choice showing (R8, FR-041, FR-046), shuffled, or null when the
 * card should fall back to a normal reveal. Pure: `rng` is injected.
 *
 * - `correct` is empty or longer than 80 characters: null.
 * - With wrong answers: up to 7 of them are sampled (de-duplicated after normalization, equal
 *   to the correct answer dropped), so at most 8 options.
 * - Without: up to 3 distractors come from `pool` (non-empty, at most 80 characters, distinct).
 * - Fewer than 2 distinct options: null.
 */
export function buildChoices(args: {
  correct: string;
  wrong: readonly string[];
  pool: readonly string[];
  rng: () => number;
}): string[] | null {
  const correct = tidy(args.correct);
  if (!correct || length(correct) > MAX_LEN) return null;
  const taken = new Set([normalizeAnswer(correct, NORM)]);
  const distinct = (list: readonly string[], limitLen: boolean): string[] => {
    const out: string[] = [];
    for (const raw of list) {
      const t = tidy(raw);
      const key = normalizeAnswer(t, NORM);
      if (!key || taken.has(key) || (limitLen && length(t) > MAX_LEN)) continue;
      taken.add(key);
      out.push(t);
    }
    return out;
  };
  const wrong = distinct(args.wrong, false);
  const picked =
    wrong.length > 0
      ? shuffle(wrong, args.rng).slice(0, MAX_WRONG)
      : shuffle(distinct(args.pool, true), args.rng).slice(0, MAX_FROM_POOL);
  if (picked.length < 1) return null;
  return shuffle([correct, ...picked], args.rng);
}
