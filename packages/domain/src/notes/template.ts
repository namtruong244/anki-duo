import { getFilter, type FilterContext, type FilterValue, type TemplateSide } from './filters.js';
import type { Answer, Interaction, NoteExtra, NoteTypeKind, Slot } from './interaction.js';
import { escapeHtml, htmlToText, sanitizeHtml, stripReservedAttrs } from './sanitize.js';
import type { NoteTypeDef, NoteFields } from './types.js';

const RESERVED = new Set(['FrontSide', 'Tags', 'Deck']);
const BAD_FIELD_CHARS = /[{}:#^/]/;
const MAX_CSS = 100_000;

/** One `name arg` segment of a filter chain, kept raw (`tts en-US`) and parsed on use. */
type Token =
  | { kind: 'text'; value: string }
  | { kind: 'var'; name: string; filters: string[] }
  | { kind: 'open'; name: string; inverse: boolean }
  | { kind: 'close'; name: string };

/** Splits `tts en-US` into its name and optional argument. */
function parseFilter(raw: string): { name: string; arg: string | undefined } {
  const m = /^(\S*)(?:\s+([\s\S]*))?$/.exec(raw.trim());
  return { name: m?.[1] ?? '', arg: m?.[2]?.trim() || undefined };
}

/** `a:b c:Field` -> filters `['a', 'b c']`, field `Field`. The last segment is the field. */
function parseChain(inner: string): { filters: string[]; name: string } {
  const parts = inner.split(':').map((p) => p.trim());
  const name = parts.pop() ?? '';
  return { filters: parts, name };
}

function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  const re = /\{\{([^{}]*)\}\}/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    if (m.index > last) tokens.push({ kind: 'text', value: src.slice(last, m.index) });
    last = m.index + m[0].length;
    const inner = (m[1] ?? '').trim();
    if (inner.startsWith('#'))
      tokens.push({ kind: 'open', name: inner.slice(1).trim(), inverse: false });
    else if (inner.startsWith('^'))
      tokens.push({ kind: 'open', name: inner.slice(1).trim(), inverse: true });
    else if (inner.startsWith('/')) tokens.push({ kind: 'close', name: inner.slice(1).trim() });
    else tokens.push({ kind: 'var', ...parseChain(inner) });
  }
  if (last < src.length) tokens.push({ kind: 'text', value: src.slice(last) });
  return tokens;
}

type Node = Token | { kind: 'section'; name: string; inverse: boolean; children: Node[] };

function parse(tokens: Token[]): Node[] {
  const root: Node[] = [];
  const stack: Array<{ name: string; inverse: boolean; children: Node[] }> = [];
  const cur = () => (stack.length ? stack[stack.length - 1]!.children : root);
  for (const t of tokens) {
    if (t.kind === 'open') {
      const sec = { name: t.name, inverse: t.inverse, children: [] as Node[] };
      cur().push({ kind: 'section', ...sec });
      stack.push(sec);
    } else if (t.kind === 'close') {
      if (stack.length && stack[stack.length - 1]!.name === t.name) stack.pop();
      // else: stray/mismatched close tag is ignored
    } else cur().push(t);
  }
  return root;
}

export function hasContent(html: string): boolean {
  return /<img\b/i.test(html) || /\[sound:[^\]]+\]/.test(html) || htmlToText(html).length > 0;
}

function errorSpan(name: string): string {
  return `<span class="tpl-error">Unknown field: ${escapeHtml(name)}</span>`;
}
function filterErrorSpan(msg: string): string {
  return `<span class="tpl-error">${escapeHtml(msg)}</span>`;
}

/** The render context minus the per-tag `fieldName`. */
type RenderServices = Omit<FilterContext, 'fieldName'>;

interface Ctx {
  byName: Map<string, string>;
  fields: NoteFields;
  tags: string[];
  deck: string;
  /** Sanitized front html (slot markers still in it), for `{{FrontSide}}`. */
  frontSide: string;
  /** Field ids referenced by variable tags (not sections) so far; drives `answerText`. */
  used: Set<string>;
  render: RenderServices;
}

function valueOf(ctx: Ctx, name: string, track = false): string | undefined {
  const id = ctx.byName.get(name);
  if (id !== undefined) {
    if (track) ctx.used.add(id);
    return clean(ctx.fields[id] ?? '');
  }
  if (name === 'Tags') return clean(escapeHtml(ctx.tags.join(' ')));
  if (name === 'Deck') return clean(escapeHtml(ctx.deck));
  if (name === 'FrontSide') return ctx.frontSide;
  return undefined;
}

/** Why a filter use is invalid, or null. Shared by `validateNoteType` and `renderNodes`. */
function filterProblem(raw: string, kind: NoteTypeKind, side: TemplateSide): string | null {
  const { name, arg } = parseFilter(raw);
  const f = getFilter(name);
  if (!f) return `unknown filter "${name}"`;
  if (f.arg === 'required' && !arg) return `filter "${name}" needs an argument`;
  if (f.arg !== 'required' && arg) return `filter "${name}" takes no argument`;
  return f.validate?.({ arg, kind, side }) ?? null;
}

/** Applies a chain right to left. Returns an error span for the first invalid filter. */
function applyChain(filters: string[], name: string, value: string, ctx: Ctx): string {
  const fctx: FilterContext = { ...ctx.render, fieldName: name };
  for (const raw of filters) {
    const problem = filterProblem(raw, fctx.kind, fctx.side);
    if (problem) {
      const { name: fname } = parseFilter(raw);
      return filterErrorSpan(
        getFilter(fname) ? `Invalid filter: ${problem}` : `Unknown filter: ${fname}`,
      );
    }
  }
  let v: FilterValue = { html: value };
  for (let i = filters.length - 1; i >= 0; i--) {
    const { name: fname, arg } = parseFilter(filters[i]!);
    v = getFilter(fname)!.apply(v, arg, fctx);
  }
  return v.html;
}

function renderNodes(nodes: Node[], ctx: Ctx): string {
  let out = '';
  for (const n of nodes) {
    if (n.kind === 'text') out += n.value;
    else if (n.kind === 'var') {
      const v = valueOf(ctx, n.name, true);
      if (v === undefined) out += errorSpan(n.name);
      else out += applyChain(n.filters, n.name, v, ctx);
    } else if (n.kind === 'section') {
      const v = valueOf(ctx, n.name);
      if (v === undefined) out += errorSpan(n.name);
      else if (hasContent(v) !== n.inverse) out += renderNodes(n.children, ctx);
    }
  }
  return out;
}

export interface RenderOptions {
  templateId: string;
  /** 0 for standard kinds; the cloze number or mask number for the kinds that fan out. */
  ordinal: number;
  tags?: string[];
  deckName?: string;
}

export interface RenderedCard {
  front: string;
  back: string;
  frontEmpty: boolean;
  /** null when no filter reserved a slot or set an answer (always null for basic cards). */
  interaction: Interaction | null;
  /** Plain text of the fields used on the back but not on the front (R8), unless a filter set it. */
  answerText: string;
}

// Private-use code points stand in for slots while a side is rendered and sanitized.
const MARK_OPEN = '\uE000';
const MARK_CLOSE = '\uE001';
const MARK_RE = /\uE000(\d+)\uE001/g;
const MARK_CHARS_RE = /[\uE000\uE001]/g;
const marker = (i: number): string => `${MARK_OPEN}${i}${MARK_CLOSE}`;

/**
 * Replaces slot markers in already sanitized html with the slot elements. Markers inside a tag
 * (an attribute value) are dropped, so a template cannot place a slot where it would break out.
 */
function resolveSlots(html: string): string {
  return html
    .split(/(<[^>]*>)/)
    .map((part, i) =>
      i % 2 === 1
        ? part.replace(MARK_CHARS_RE, '')
        : part.replace(
            MARK_RE,
            (_m, n: string) => `<span class="ad-slot" id="ad-slot-${n}"></span>`,
          ),
    )
    .join('');
}

/** Author markup is cleaned of reserved names and of the marker characters. */
function clean(src: string): string {
  return stripReservedAttrs(src).replace(MARK_CHARS_RE, '');
}

/**
 * Renders one card of a note: the card `(templateId, ordinal)`. Pure.
 * Field values and templates are stripped of reserved names, rendered, sanitized, and only then
 * are interaction slots appended, so the stored html never contains author-made slots (R4).
 */
export function renderCard(
  def: NoteTypeDef,
  fields: NoteFields,
  extra: NoteExtra | null,
  opts: RenderOptions,
): RenderedCard {
  const template = def.templates.find((t) => t.id === opts.templateId);
  if (!template) throw new Error(`Unknown template "${opts.templateId}"`);
  const slots: Slot[] = [];
  let answer: Answer | null = null;
  let answerTextOverride: string | undefined;
  const ctx: Ctx = {
    byName: new Map(def.fields.map((f) => [f.name, f.id] as const)),
    fields,
    tags: opts.tags ?? [],
    deck: opts.deckName ?? '',
    frontSide: '',
    used: new Set(),
    render: {
      def,
      kind: def.kind ?? 'standard',
      options: def.options ?? {},
      fields,
      extra,
      templateId: opts.templateId,
      ordinal: opts.ordinal,
      slots,
      side: 'front',
      addSlot(slot) {
        slots.push(slot);
        return marker(slots.length - 1);
      },
      slotMarker: marker,
      state: new Map(),
      setAnswer(a) {
        answer = a;
      },
      setAnswerText(t) {
        answerTextOverride = t;
      },
    },
  };
  const side = (src: string, which: TemplateSide): string => {
    ctx.render.side = which;
    return sanitizeHtml(renderNodes(parse(tokenize(clean(src))), ctx));
  };
  const front = side(template.front, 'front');
  const frontUsed = new Set(ctx.used);
  ctx.frontSide = front;
  const back = side(template.back, 'back');
  const backOnly = [...ctx.used].filter((id) => !frontUsed.has(id));
  const answerText =
    answerTextOverride ??
    backOnly
      .map((id) => htmlToText(sanitizeHtml(clean(fields[id] ?? ''))))
      .filter(Boolean)
      .join('\n');
  const interaction: Interaction | null =
    slots.length > 0 || answer !== null ? { v: 1, slots: [...slots], answer } : null;
  return {
    front: resolveSlots(front),
    back: resolveSlots(back),
    frontEmpty: !hasContent(front),
    interaction,
    answerText,
  };
}

/**
 * Ids of the fields that the front of template `templateId` runs through the filter
 * `filterName` (anywhere in the chain, inside sections too). Used by the cloze and occlusion
 * card fan-out (R2).
 */
export function frontFieldsWithFilter(
  def: NoteTypeDef,
  templateId: string,
  filterName: string,
): string[] {
  const tpl = def.templates.find((t) => t.id === templateId);
  if (!tpl) return [];
  const byName = new Map(def.fields.map((f) => [f.name, f.id] as const));
  const ids = new Set<string>();
  for (const t of tokenize(tpl.front ?? '')) {
    if (t.kind !== 'var' || !t.filters.some((f) => parseFilter(f).name === filterName)) continue;
    const id = byName.get(t.name);
    if (id !== undefined) ids.add(id);
  }
  return [...ids];
}

function checkTemplateSide(
  label: string,
  src: string,
  fieldNames: Set<string>,
  isFront: boolean,
  kind: NoteTypeKind,
  errors: string[],
): boolean {
  let referencesField = false;
  const open: string[] = [];
  for (const t of tokenize(src)) {
    if (t.kind === 'text') continue;
    if (t.name === '') {
      errors.push(`${label}: empty tag {{}}`);
      continue;
    }
    if (t.kind === 'close') {
      const top = open.pop();
      if (top === undefined)
        errors.push(`${label}: closing {{/${t.name}}} without matching opening tag`);
      else if (top !== t.name)
        errors.push(`${label}: {{/${t.name}}} does not match open section {{#${top}}}`);
      continue;
    }
    if (t.kind === 'open') open.push(t.name);
    if (t.kind === 'var') {
      for (const raw of t.filters) {
        const problem = filterProblem(raw, kind, isFront ? 'front' : 'back');
        if (problem) errors.push(`${label}: ${problem}`);
      }
    }
    if (fieldNames.has(t.name)) referencesField = true;
    else if (t.name === 'FrontSide') {
      if (isFront) errors.push(`${label}: {{FrontSide}} can only be used on the back template`);
    } else if (!RESERVED.has(t.name)) errors.push(`${label}: unknown field "${t.name}"`);
  }
  for (const o of open) errors.push(`${label}: section {{#${o}}} is never closed`);
  return referencesField;
}

function usesFilter(src: string, name: string): boolean {
  return tokenize(src).some((t) => t.kind === 'var' && t.filters.some((f) => parseFilter(f).name === name));
}

/** Filters that are interactive (they reserve a slot). */
const INTERACTIVE = ['type', 'choice', 'occlusion'];

/**
 * Non-blocking problems (contracts/template-syntax.md): more than one `{{type:}}` on a side
 * (only the first is interactive), and an interactive tag that is only on the back (shown as
 * the answer, not interactive). Pure.
 */
export function noteTypeWarnings(def: NoteTypeDef): string[] {
  const warnings: string[] = [];
  for (const t of def.templates ?? []) {
    const label = `Template "${(t.name ?? '').trim() || t.id}"`;
    const count = (src: string, name: string): number =>
      tokenize(src).filter(
        (k) => k.kind === 'var' && k.filters.some((f) => parseFilter(f).name === name),
      ).length;
    for (const side of ['front', 'back'] as const) {
      if (count(t[side] ?? '', 'type') > 1)
        warnings.push(`${label} ${side}: more than one {{type:}}, only the first is interactive`);
    }
    for (const name of INTERACTIVE)
      if (count(t.front ?? '', name) === 0 && count(t.back ?? '', name) > 0)
        warnings.push(`${label}: ${name} is only on the back, so it is not interactive`);
  }
  return warnings;
}

export function validateNoteType(def: NoteTypeDef): string[] {
  const errors: string[] = [];
  if (!def.fields || def.fields.length < 1) errors.push('A note type needs at least one field');
  if (!def.templates || def.templates.length < 1)
    errors.push('A note type needs at least one card template');
  const fieldNames = new Set<string>();
  const fieldIds = new Set<string>();
  for (const f of def.fields ?? []) {
    if (!f.id) errors.push('Every field needs an id');
    else if (fieldIds.has(f.id)) errors.push(`Duplicate field id "${f.id}"`);
    fieldIds.add(f.id);
    const name = f.name ?? '';
    if (name.trim() === '') errors.push('Field names cannot be empty');
    else if (name !== name.trim())
      errors.push(`Field name "${name}" cannot start or end with spaces`);
    else if (BAD_FIELD_CHARS.test(name))
      errors.push(`Field name "${name}" cannot contain any of { } : # ^ /`);
    else if (RESERVED.has(name)) errors.push(`Field name "${name}" is reserved`);
    else if (fieldNames.has(name)) errors.push(`Duplicate field name "${name}"`);
    fieldNames.add(name);
  }
  const kind = def.kind ?? 'standard';
  const tplNames = new Set<string>();
  const tplIds = new Set<string>();
  for (const t of def.templates ?? []) {
    if (!t.id) errors.push('Every template needs an id');
    else if (tplIds.has(t.id)) errors.push(`Duplicate template id "${t.id}"`);
    tplIds.add(t.id);
    const name = (t.name ?? '').trim();
    if (name === '') errors.push('Template names cannot be empty');
    else if (tplNames.has(name)) errors.push(`Duplicate template name "${name}"`);
    tplNames.add(name);
    const label = `Template "${name || t.id}"`;
    const frontHas = checkTemplateSide(
      `${label} front`,
      t.front ?? '',
      fieldNames,
      true,
      kind,
      errors,
    );
    if (!frontHas) errors.push(`${label} front must reference at least one field`);
    checkTemplateSide(`${label} back`, t.back ?? '', fieldNames, false, kind, errors);
    if (kind === 'cloze' && frontHas && !usesFilter(t.front ?? '', 'cloze'))
      errors.push(`${label} front must use the cloze filter, for example {{cloze:Text}}`);
  }
  if (kind === 'multiple_choice') {
    const roles = def.options?.roles;
    if (!roles) errors.push('A multiple-choice note type needs options.roles');
    else
      for (const r of ['correct', 'wrong', 'explanation'] as const)
        if (!fieldIds.has(roles[r] ?? ''))
          errors.push(`options.roles.${r} must be the id of one of the fields`);
  }
  if ((def.css ?? '').length > MAX_CSS) errors.push(`CSS is too long (max ${MAX_CSS} characters)`);
  return errors;
}

function renameIn(src: string, oldName: string, newName: string): string {
  return src.replace(/\{\{([^{}]*)\}\}/g, (m, inner: string) => {
    const mm = /^\s*([#^/])?\s*([\s\S]*?)\s*$/.exec(inner);
    const prefix = mm?.[1];
    if (prefix) return mm![2] === oldName ? `{{${prefix}${newName}}}` : m;
    const { filters, name } = parseChain(inner);
    if (name !== oldName) return m;
    return `{{${[...filters, newName].join(':')}}}`;
  });
}

export function renameFieldInTemplates(
  def: NoteTypeDef,
  oldName: string,
  newName: string,
): NoteTypeDef {
  return {
    ...def,
    templates: def.templates.map((t) => ({
      ...t,
      front: renameIn(t.front, oldName, newName),
      back: renameIn(t.back, oldName, newName),
    })),
  };
}
