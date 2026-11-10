/**
 * Cloze scanner and renderer (002, R5) plus the `cloze` and `hint` filters and the cloze card
 * fan-out. Registered at module load through `notes/index.ts`.
 *
 * Markers are `{{cN::answer}}` or `{{cN::answer::hint}}` with N a positive integer without
 * leading zeros. Markers nest. The scanner skips tag interiors, so attribute text is never
 * read. Malformed markers stay literal text.
 */
import { registerFilter } from './filters.js';
import type { FilterDef } from './filters.js';
import { escapeHtml, htmlToText, sanitizeHtml } from './sanitize.js';
import { registerSlotLister } from './slots.js';
import { frontFieldsWithFilter, hasContent } from './template.js';

export interface ClozeMatch {
  n: number;
  /** Raw html between `::` and the hint or closing `}}` (nested markers still in it). */
  answerHtml: string;
  hint?: string;
  /** Offsets into the scanned html: `html.slice(start, end)` is the whole marker. */
  start: number;
  end: number;
  /** Markers nested in the answer, in order. */
  children: ClozeMatch[];
}

export type ClozeProblemKind = 'unterminated' | 'invalid_number' | 'unmatched_close';

export interface ClozeProblem {
  kind: ClozeProblemKind;
  /** Offsets of the offending text (the opener, or the stray `}}`). */
  start: number;
  end: number;
  message: string;
}

/** A note may produce at most this many cards (data-model limits). */
export const MAX_CARDS_PER_NOTE = 100;

const MAX_DEPTH = 20;
const OPENER = /^\{\{c([1-9]\d{0,8})::/;
const BAD_OPENER = /^\{\{c([^\s:{}]*)::/;

/** Index just after the tag starting at `i`, or -1 when `i` does not start a tag. */
function tagEnd(html: string, i: number): number {
  if (html[i] !== '<' || !/[a-zA-Z/!?]/.test(html[i + 1] ?? '')) return -1;
  let quote = '';
  for (let j = i + 1; j < html.length; j++) {
    const c = html[j]!;
    if (quote) {
      if (c === quote) quote = '';
    } else if (c === '"' || c === "'") quote = c;
    else if (c === '>') return j + 1;
  }
  return -1;
}

interface Scan {
  html: string;
  memo: Map<number, ClozeMatch | null>;
}

/** Parses the marker whose opener is at `at`; null when it is never closed. Memoized. */
function parseMarker(sc: Scan, at: number, depth: number): ClozeMatch | null {
  if (sc.memo.has(at)) return sc.memo.get(at) ?? null;
  const { html } = sc;
  const open = OPENER.exec(html.slice(at, at + 16));
  if (!open || depth > MAX_DEPTH) {
    sc.memo.set(at, null);
    return null;
  }
  const n = Number(open[1]);
  const answerStart = at + open[0].length;
  let p = answerStart;
  let sep = -1;
  const children: ClozeMatch[] = [];
  let result: ClozeMatch | null = null;
  // Malformed `{{c0::` openers inside a marker are literal groups that own their `}}`.
  let literalGroups = 0;
  while (p < html.length) {
    const t = tagEnd(html, p);
    if (t > 0) {
      p = t;
      continue;
    }
    if (html.startsWith('{{c', p)) {
      const child = parseMarker(sc, p, depth + 1);
      if (child) {
        if (sep < 0) children.push(child);
        p = child.end;
      } else {
        const head = html.slice(p, p + 40);
        if (!OPENER.test(head) && BAD_OPENER.test(head)) literalGroups++;
        p += 2;
      }
      continue;
    }
    if (html.startsWith('}}', p)) {
      if (literalGroups > 0) {
        literalGroups--;
        p += 2;
        continue;
      }
      const hint = sep < 0 ? undefined : html.slice(sep + 2, p);
      result = {
        n,
        answerHtml: html.slice(answerStart, sep < 0 ? p : sep),
        ...(hint ? { hint } : {}),
        start: at,
        end: p + 2,
        children,
      };
      break;
    }
    if (sep < 0 && html.startsWith('::', p)) {
      sep = p;
      p += 2;
      continue;
    }
    p++;
  }
  sc.memo.set(at, result);
  return result;
}

/** The top-level markers of sanitized html, in order. Pure. */
export function parseCloze(html: string): ClozeMatch[] {
  const sc: Scan = { html, memo: new Map() };
  const out: ClozeMatch[] = [];
  let p = 0;
  while (p < html.length) {
    const t = tagEnd(html, p);
    if (t > 0) {
      p = t;
      continue;
    }
    if (html.startsWith('{{c', p)) {
      const m = parseMarker(sc, p, 0);
      if (m) {
        out.push(m);
        p = m.end;
      } else p += 2;
      continue;
    }
    p++;
  }
  return out;
}

/** Every malformed marker in sanitized html, for the editor warning. Pure. */
export function findClozeProblems(html: string): ClozeProblem[] {
  const sc: Scan = { html, memo: new Map() };
  const problems: ClozeProblem[] = [];
  const closers = new Set<number>();
  // First pass: terminated markers (anywhere, including nested) and their closing `}}`.
  let p = 0;
  while (p < html.length) {
    const t = tagEnd(html, p);
    if (t > 0) {
      p = t;
      continue;
    }
    if (html.startsWith('{{c', p) && OPENER.test(html.slice(p, p + 16))) {
      const m = parseMarker(sc, p, 0);
      if (m) closers.add(m.end - 2);
    }
    p++;
  }
  let pendingInvalid = 0;
  p = 0;
  while (p < html.length) {
    const t = tagEnd(html, p);
    if (t > 0) {
      p = t;
      continue;
    }
    if (html.startsWith('{{c', p)) {
      const slice = html.slice(p, p + 16);
      const open = OPENER.exec(slice);
      if (open) {
        if (!parseMarker(sc, p, 0))
          problems.push({
            kind: 'unterminated',
            start: p,
            end: p + open[0].length,
            message: `Marker ${open[0]} is never closed with }}`,
          });
      } else {
        const bad = BAD_OPENER.exec(html.slice(p, p + 40));
        if (bad) {
          pendingInvalid++;
          problems.push({
            kind: 'invalid_number',
            start: p,
            end: p + bad[0].length,
            message: `"${bad[0]}" needs a whole number from 1 (for example {{c1::)`,
          });
          p += bad[0].length;
          continue;
        }
      }
      p += 2;
      continue;
    }
    if (html.startsWith('}}', p)) {
      if (closers.has(p)) {
        // closes a valid marker
      } else if (pendingInvalid > 0) pendingInvalid--;
      else
        problems.push({
          kind: 'unmatched_close',
          start: p,
          end: p + 2,
          message: 'Unmatched }}',
        });
      p += 2;
      continue;
    }
    p++;
  }
  return problems;
}

function answerStartOf(m: ClozeMatch): number {
  return m.start + 3 + String(m.n).length + 2;
}

/** Replaces the markers of `ms` inside html[from, to) by their rendering. */
function renderRange(
  html: string,
  from: number,
  to: number,
  ms: ClozeMatch[],
  n: number,
  side: 'front' | 'back',
  plain: boolean,
): string {
  let out = '';
  let at = from;
  for (const m of ms) {
    out += html.slice(at, m.start);
    const inner = (): string =>
      renderRange(html, answerStartOf(m), answerStartOf(m) + m.answerHtml.length, m.children, n, side, plain || m.n === n);
    if (!plain && m.n === n) {
      out +=
        side === 'front'
          ? `<span class="cloze">[${m.hint ? escapeHtml(htmlToText(m.hint)) : '...'}]</span>`
          : `<span class="cloze">${renderRange(html, answerStartOf(m), answerStartOf(m) + m.answerHtml.length, m.children, n, side, true)}</span>`;
    } else out += inner();
    at = m.end;
  }
  return out + html.slice(at, to);
}

/**
 * Renders sanitized field html for card `n`. Front: each cN becomes `<span class="cloze">[hint]</span>`
 * or `[...]`; other numbers show their answer. Back: each cN becomes `<span class="cloze">answer</span>`.
 * A nested cN inside a hidden or highlighted outer marker is rendered as plain answer text.
 */
export function renderCloze(html: string, n: number, side: 'front' | 'back'): string {
  return renderRange(html, 0, html.length, parseCloze(html), n, side, false);
}

/** Plain-text answers of card `n`, in document order (outermost markers of number n). */
export function clozeAnswers(html: string, n: number): string[] {
  const out: string[] = [];
  const walk = (ms: ClozeMatch[]): void => {
    for (const m of ms) {
      if (m.n === n) {
        const a = answerStartOf(m);
        out.push(htmlToText(renderRange(html, a, a + m.answerHtml.length, m.children, n, 'back', true)));
      } else walk(m.children);
    }
  };
  walk(parseCloze(html));
  return out;
}

/** The distinct cloze numbers present in sanitized html (nested ones included). */
function clozeNumbers(html: string): number[] {
  const set = new Set<number>();
  const walk = (ms: ClozeMatch[]): void => {
    for (const m of ms) {
      set.add(m.n);
      walk(m.children);
    }
  };
  walk(parseCloze(html));
  return [...set];
}

const clozeFilter: FilterDef = {
  name: 'cloze',
  validate: ({ kind }) =>
    kind === 'cloze' ? null : 'the cloze filter can only be used in a cloze note type',
  apply(value, _arg, ctx) {
    const html = sanitizeHtml(value.html);
    return {
      html: renderCloze(html, ctx.ordinal, ctx.side),
      expected: clozeAnswers(html, ctx.ordinal).join(', '),
    };
  },
};

const hintFilter: FilterDef = {
  name: 'hint',
  apply: (value) => ({
    html: hasContent(value.html)
      ? `<details class="ad-hint"><summary></summary>${value.html}</details>`
      : '',
  }),
};

registerFilter(clozeFilter);
registerFilter(hintFilter);

registerSlotLister('cloze', (def, fields) =>
  def.templates.flatMap((t) => {
    const nums = new Set<number>();
    for (const id of frontFieldsWithFilter(def, t.id, 'cloze'))
      for (const n of clozeNumbers(sanitizeHtml(fields[id] ?? ''))) nums.add(n);
    return [...nums].sort((a, b) => a - b).map((ordinal) => ({ templateId: t.id, ordinal }));
  }),
);
