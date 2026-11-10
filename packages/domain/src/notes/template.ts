import { escapeHtml, htmlToText, sanitizeHtml } from './sanitize.js';
import type { NoteTemplate, NoteTypeDef, NoteFields } from './types.js';

const RESERVED = new Set(['FrontSide', 'Tags', 'Deck']);
const BAD_FIELD_CHARS = /[{}:#^/]/;
const MAX_CSS = 100_000;

type Token =
  | { kind: 'text'; value: string }
  | { kind: 'var'; name: string; textOnly: boolean }
  | { kind: 'open'; name: string; inverse: boolean }
  | { kind: 'close'; name: string };

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
    else if (/^text\s*:/.test(inner))
      tokens.push({ kind: 'var', name: inner.replace(/^text\s*:/, '').trim(), textOnly: true });
    else tokens.push({ kind: 'var', name: inner, textOnly: false });
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

interface Ctx {
  byName: Map<string, string>;
  fields: NoteFields;
  tags: string[];
  deck: string;
  frontSide: string;
}

function valueOf(ctx: Ctx, name: string): string | undefined {
  const id = ctx.byName.get(name);
  if (id !== undefined) return ctx.fields[id] ?? '';
  if (name === 'Tags') return escapeHtml(ctx.tags.join(' '));
  if (name === 'Deck') return escapeHtml(ctx.deck);
  if (name === 'FrontSide') return ctx.frontSide;
  return undefined;
}

function renderNodes(nodes: Node[], ctx: Ctx): string {
  let out = '';
  for (const n of nodes) {
    if (n.kind === 'text') out += n.value;
    else if (n.kind === 'var') {
      const v = valueOf(ctx, n.name);
      if (v === undefined) out += errorSpan(n.name);
      else out += n.textOnly ? escapeHtml(htmlToText(v)) : v;
    } else if (n.kind === 'section') {
      const v = valueOf(ctx, n.name);
      if (v === undefined) out += errorSpan(n.name);
      else if (hasContent(v) !== n.inverse) out += renderNodes(n.children, ctx);
    }
  }
  return out;
}

export function renderCard(
  def: NoteTypeDef,
  template: NoteTemplate,
  fields: NoteFields,
  opts?: { tags?: string[]; deckName?: string },
): { front: string; back: string; frontEmpty: boolean } {
  const byName = new Map(def.fields.map((f) => [f.name, f.id] as const));
  const ctx: Ctx = {
    byName,
    fields,
    tags: opts?.tags ?? [],
    deck: opts?.deckName ?? '',
    frontSide: '',
  };
  const front = sanitizeHtml(renderNodes(parse(tokenize(template.front)), ctx));
  ctx.frontSide = front;
  const back = sanitizeHtml(renderNodes(parse(tokenize(template.back)), ctx));
  return { front, back, frontEmpty: !hasContent(front) };
}

function checkTemplateSide(
  label: string,
  src: string,
  fieldNames: Set<string>,
  isFront: boolean,
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
    if (fieldNames.has(t.name)) referencesField = true;
    else if (t.name === 'FrontSide') {
      if (isFront) errors.push(`${label}: {{FrontSide}} can only be used on the back template`);
    } else if (!RESERVED.has(t.name)) errors.push(`${label}: unknown field "${t.name}"`);
  }
  for (const o of open) errors.push(`${label}: section {{#${o}}} is never closed`);
  return referencesField;
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
    const frontHas = checkTemplateSide(`${label} front`, t.front ?? '', fieldNames, true, errors);
    if (!frontHas) errors.push(`${label} front must reference at least one field`);
    checkTemplateSide(`${label} back`, t.back ?? '', fieldNames, false, errors);
  }
  if ((def.css ?? '').length > MAX_CSS) errors.push(`CSS is too long (max ${MAX_CSS} characters)`);
  return errors;
}

function renameIn(src: string, oldName: string, newName: string): string {
  return src.replace(/\{\{([^{}]*)\}\}/g, (m, inner: string) => {
    const mm = /^\s*(#|\^|\/|text\s*:)?\s*([\s\S]*?)\s*$/.exec(inner);
    if (!mm || mm[2] !== oldName) return m;
    const prefix = (mm[1] ?? '').replace(/\s+/g, '');
    return `{{${prefix}${newName}}}`;
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
