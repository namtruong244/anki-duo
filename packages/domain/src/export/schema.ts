import type {
  Interaction,
  NoteExtra,
  NoteTypeKind,
  NoteTypeOptions,
} from '../notes/interaction.js';
import { NOTE_TYPE_KINDS } from '../notes/interaction.js';
import {
  newCard,
  replay,
  type FsrsState,
  type Grade,
  type ReplayLog,
  type SchedulerParams,
} from '../scheduler/index.js';

/** `anki-duo-export` v2 (specs/002-.../contracts/export-format-v2.md); v1 files are still read. */
export const EXPORT_FORMAT = 'anki-duo-export';
export const EXPORT_VERSION = 2;
export const SUPPORTED_EXPORT_VERSIONS: readonly number[] = [1, 2];

export interface ExportFsrs {
  state: FsrsState['state'];
  due: string;
  stability: number;
  difficulty: number;
  learningSteps: number;
  reps: number;
  lapses: number;
  lastReview: string | null;
}
export interface ExportMedia {
  id: string;
  side: 'front' | 'back';
  kind: 'image' | 'audio';
  mime: string;
  bytes: number;
  url?: string;
  sha256?: string;
}
export interface ExportCard {
  id: string;
  position: number;
  nodeIndex: number;
  front: string;
  back: string;
  tags: string[];
  suspended: boolean;
  createdAt: string;
  fsrs: ExportFsrs;
  media: ExportMedia[];
  /** Note cards only (absent or null on legacy Markdown cards). */
  noteId?: string | null;
  noteTypeId?: string | null;
  templateId?: string | null;
  format?: 'markdown' | 'html';
  /** v2; absent in v1 files (default 0). */
  ordinal?: number;
  /** v2; absent in v1 files (default ""). Recomputed on restore. */
  answerText?: string;
  /** v2, informational only: restore recomputes it and never trusts this. */
  interaction?: Interaction | null;
}
export interface ExportNoteType {
  id: string;
  name: string;
  fields: { id: string; name: string }[];
  templates: { id: string; name: string; front: string; back: string }[];
  css: string;
  /** v2; default 'standard'. */
  kind?: NoteTypeKind;
  /** v2; default {}. */
  options?: NoteTypeOptions;
  /** v2; default null. */
  builtinKey?: string | null;
}
export interface ExportNote {
  id: string;
  noteTypeId: string;
  fields: Record<string, string>;
  tags: string[];
  createdAt: string;
  /** v2; default null. */
  extra?: NoteExtra | null;
}
export interface ExportReview {
  id: string;
  cardId: string;
  kind: 'review' | 'reset';
  grade: Grade | null;
  reviewedAt: string;
  durationMs: number;
  wasNew: boolean;
  wasDue: boolean;
  studyAhead: boolean;
  schedulerVersion: string;
  revokedAt: string | null;
  /** Optional extension: the parameters this review was scheduled with. */
  desiredRetention?: number;
  maximumIntervalDays?: number;
}
export interface ExportDoc {
  format: typeof EXPORT_FORMAT;
  version: 1 | 2;
  exportedAt: string;
  scheduler: {
    algorithm: string;
    implementation: string;
    desiredRetention: number;
    maximumIntervalDays: number;
    parameters: number[];
  };
  deck: {
    id: string;
    name: string;
    newCardsPerDay: number;
    createdAt: string;
    /** v2; default false. */
    mcPractice?: boolean;
  };
  /** Optional extension: note types and notes of the deck's note cards. */
  noteTypes?: ExportNoteType[];
  notes?: ExportNote[];
  cards: ExportCard[];
  reviews: ExportReview[];
}

export class ExportInvalidError extends Error {}

const fail = (msg: string): never => {
  throw new ExportInvalidError(msg);
};
const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown, what: string) =>
  typeof v === 'string' ? v : fail(`${what} must be a string`);
const num = (v: unknown, what: string) =>
  typeof v === 'number' && Number.isFinite(v) ? v : fail(`${what} must be a number`);
const iso = (v: unknown, what: string) =>
  Number.isNaN(Date.parse(str(v, what))) ? fail(`${what} must be a date`) : (v as string);
const arr = (v: unknown, what: string) =>
  Array.isArray(v) ? (v as unknown[]) : fail(`${what} must be an array`);
const obj = (v: unknown, what: string) => (isObj(v) ? v : fail(`${what} must be an object`));

const optInt = (v: unknown, what: string): void => {
  if (v !== undefined && (typeof v !== 'number' || !Number.isInteger(v) || v < 0))
    fail(`${what} must be an integer >= 0`);
};

/** `extra` of a note: only the occlusion shape is known; unknown keys are ignored. */
function checkExtra(v: unknown, what: string): void {
  if (v === undefined || v === null) return;
  const e = obj(v, what);
  if (e.occlusion === undefined || e.occlusion === null) return;
  const o = obj(e.occlusion, `${what}.occlusion`);
  if (o.mode !== 'hide_all' && o.mode !== 'hide_one') fail(`${what}.occlusion.mode invalid`);
  const seen = new Set<number>();
  for (const [i, m] of arr(o.masks, `${what}.occlusion.masks`).entries()) {
    const mk = obj(m, `${what}.occlusion.masks[${i}]`);
    const n = num(mk.n, 'mask.n');
    if (!Number.isInteger(n) || n < 1) fail('mask.n must be an integer >= 1');
    if (seen.has(n)) fail('mask.n must be unique');
    seen.add(n);
    if (mk.shape !== 'rect' && mk.shape !== 'ellipse') fail('mask.shape invalid');
    for (const k of ['x', 'y', 'w', 'h']) {
      const c = num(mk[k], `mask.${k}`);
      if (c < 0 || c > 1) fail(`mask.${k} must be within 0..1`);
    }
    if (mk.label !== undefined) str(mk.label, 'mask.label');
  }
}

/**
 * Checks `format` and `version` first, then the shape. Unknown fields are ignored (v1 readers).
 * Accepts versions 1 and 2. The returned doc is the input object with the v2 defaults filled in
 * (`kind` 'standard', `options` {}, `builtinKey` null, `extra` null, `ordinal` 0, `answerText` '',
 * `mcPractice` false), so callers read v1 and v2 files the same way. */
export function parseExport(input: unknown): ExportDoc {
  const d = obj(input, 'export');
  if (d.format !== EXPORT_FORMAT) fail('format must be "anki-duo-export"');
  if (!SUPPORTED_EXPORT_VERSIONS.includes(d.version as number)) fail('unsupported version');
  iso(d.exportedAt, 'exportedAt');
  const s = obj(d.scheduler, 'scheduler');
  num(s.desiredRetention, 'scheduler.desiredRetention');
  num(s.maximumIntervalDays, 'scheduler.maximumIntervalDays');
  const deck = obj(d.deck, 'deck');
  str(deck.id, 'deck.id');
  str(deck.name, 'deck.name');
  num(deck.newCardsPerDay, 'deck.newCardsPerDay');
  if (deck.mcPractice !== undefined && typeof deck.mcPractice !== 'boolean')
    fail('deck.mcPractice must be a boolean');
  for (const [i, c] of arr(d.cards, 'cards').entries()) {
    const card = obj(c, `cards[${i}]`);
    str(card.id, 'card.id');
    num(card.position, 'card.position');
    num(card.nodeIndex, 'card.nodeIndex');
    str(card.front, 'card.front');
    str(card.back, 'card.back');
    arr(card.tags, 'card.tags');
    iso(card.createdAt, 'card.createdAt');
    const f = obj(card.fsrs, 'card.fsrs');
    if (!['new', 'learning', 'review', 'relearning'].includes(f.state as string))
      fail('card.fsrs.state invalid');
    iso(f.due, 'fsrs.due');
    for (const k of ['stability', 'difficulty', 'learningSteps', 'reps', 'lapses'])
      num(f[k], `fsrs.${k}`);
    if (f.lastReview !== null) iso(f.lastReview, 'fsrs.lastReview');
    arr(card.media ?? [], 'card.media');
    optInt(card.ordinal, 'card.ordinal');
    if (card.answerText !== undefined) str(card.answerText, 'card.answerText');
  }
  const noteTypeIds = new Set<string>();
  for (const [i, n] of arr(d.noteTypes ?? [], 'noteTypes').entries()) {
    const nt = obj(n, `noteTypes[${i}]`);
    noteTypeIds.add(str(nt.id, 'noteType.id'));
    str(nt.name, 'noteType.name');
    str(nt.css, 'noteType.css');
    if (nt.kind !== undefined && !NOTE_TYPE_KINDS.includes(nt.kind as NoteTypeKind))
      fail('noteType.kind invalid');
    if (nt.options !== undefined) obj(nt.options, 'noteType.options');
    if (nt.builtinKey !== undefined && nt.builtinKey !== null)
      str(nt.builtinKey, 'noteType.builtinKey');
    for (const f of arr(nt.fields, 'noteType.fields')) {
      const fo = obj(f, 'noteType.field');
      str(fo.id, 'field.id');
      str(fo.name, 'field.name');
    }
    for (const tp of arr(nt.templates, 'noteType.templates')) {
      const to = obj(tp, 'noteType.template');
      for (const k of ['id', 'name', 'front', 'back']) str(to[k], `template.${k}`);
    }
  }
  const noteIds = new Set<string>();
  for (const [i, n] of arr(d.notes ?? [], 'notes').entries()) {
    const note = obj(n, `notes[${i}]`);
    noteIds.add(str(note.id, 'note.id'));
    if (!noteTypeIds.has(str(note.noteTypeId, 'note.noteTypeId')))
      fail('note refers to an unknown note type');
    const nf = obj(note.fields, 'note.fields');
    for (const v of Object.values(nf)) str(v, 'note field value');
    arr(note.tags, 'note.tags');
    iso(note.createdAt, 'note.createdAt');
    checkExtra(note.extra, 'note.extra');
  }
  for (const c of d.cards as Record<string, unknown>[]) {
    if (c.noteId !== undefined && c.noteId !== null && !noteIds.has(str(c.noteId, 'card.noteId')))
      fail('card refers to an unknown note');
    if (c.format !== undefined && c.format !== 'markdown' && c.format !== 'html')
      fail('card.format invalid');
    if (c.noteId && typeof c.templateId !== 'string') fail('note card needs a templateId');
  }
  const ids = new Set((d.cards as { id: string }[]).map((c) => c.id));
  for (const [i, r] of arr(d.reviews, 'reviews').entries()) {
    const rv = obj(r, `reviews[${i}]`);
    str(rv.id, 'review.id');
    if (!ids.has(str(rv.cardId, 'review.cardId'))) fail('review refers to an unknown card');
    if (rv.kind !== 'review' && rv.kind !== 'reset') fail('review.kind invalid');
    if (rv.kind === 'review' && ![1, 2, 3, 4].includes(rv.grade as number))
      fail('review.grade invalid');
    iso(rv.reviewedAt, 'review.reviewedAt');
    if (rv.revokedAt !== null) iso(rv.revokedAt, 'review.revokedAt');
  }
  // Defaults for fields that v1 files lack (written by v2 writers always).
  deck.mcPractice ??= false;
  for (const nt of (d.noteTypes ?? []) as Record<string, unknown>[]) {
    nt.kind ??= 'standard';
    nt.options ??= {};
    nt.builtinKey ??= null;
  }
  for (const n of (d.notes ?? []) as Record<string, unknown>[]) n.extra ??= null;
  for (const c of d.cards as Record<string, unknown>[]) {
    c.ordinal ??= 0;
    c.answerText ??= '';
  }
  return d as unknown as ExportDoc;
}

export const exportParams = (doc: ExportDoc): SchedulerParams => ({
  desiredRetention: doc.scheduler.desiredRetention,
  maximumIntervalDays: doc.scheduler.maximumIntervalDays,
});

export function toReplayLog(r: ExportReview, doc: ExportDoc): ReplayLog {
  return {
    id: r.id,
    kind: r.kind,
    grade: r.grade,
    reviewedAt: new Date(r.reviewedAt),
    revokedAt: r.revokedAt ? new Date(r.revokedAt) : null,
    params: {
      desiredRetention: r.desiredRetention ?? doc.scheduler.desiredRetention,
      maximumIntervalDays: r.maximumIntervalDays ?? doc.scheduler.maximumIntervalDays,
    },
  };
}

const sameState = (a: FsrsState, b: ExportFsrs) =>
  a.state === b.state &&
  a.due.getTime() === Date.parse(b.due) &&
  a.stability === b.stability &&
  a.difficulty === b.difficulty &&
  a.learningSteps === b.learningSteps &&
  a.reps === b.reps &&
  a.lapses === b.lapses &&
  (a.lastReview ? a.lastReview.getTime() : null) ===
    (b.lastReview ? Date.parse(b.lastReview) : null);

/** Replays every card's history; the result must equal the exported state or the file is invalid. */
export function verifyExport(doc: ExportDoc): void {
  const byCard = new Map<string, ExportReview[]>();
  for (const r of doc.reviews) byCard.set(r.cardId, [...(byCard.get(r.cardId) ?? []), r]);
  const params = exportParams(doc);
  for (const c of doc.cards) {
    const logs = (byCard.get(c.id) ?? []).map((r) => toReplayLog(r, doc));
    const state = replay(newCard(new Date(c.createdAt)), logs, params);
    if (!sameState(state, c.fsrs))
      fail(`history does not reproduce the scheduling state of card ${c.id}`);
  }
}
