import {
  newCard,
  replay,
  type FsrsState,
  type Grade,
  type ReplayLog,
  type SchedulerParams,
} from '../scheduler/index.js';

/** `anki-duo-export` v1 (specs/.../contracts/export-format.md). */
export const EXPORT_FORMAT = 'anki-duo-export';
export const EXPORT_VERSION = 1;

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
  version: 1;
  exportedAt: string;
  scheduler: {
    algorithm: string;
    implementation: string;
    desiredRetention: number;
    maximumIntervalDays: number;
    parameters: number[];
  };
  deck: { id: string; name: string; newCardsPerDay: number; createdAt: string };
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

/** Checks `format` and `version` first, then the shape. Unknown fields are ignored (v1 readers). */
export function parseExport(input: unknown): ExportDoc {
  const d = obj(input, 'export');
  if (d.format !== EXPORT_FORMAT) fail('format must be "anki-duo-export"');
  if (d.version !== EXPORT_VERSION) fail('unsupported version');
  iso(d.exportedAt, 'exportedAt');
  const s = obj(d.scheduler, 'scheduler');
  num(s.desiredRetention, 'scheduler.desiredRetention');
  num(s.maximumIntervalDays, 'scheduler.maximumIntervalDays');
  const deck = obj(d.deck, 'deck');
  str(deck.id, 'deck.id');
  str(deck.name, 'deck.name');
  num(deck.newCardsPerDay, 'deck.newCardsPerDay');
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
