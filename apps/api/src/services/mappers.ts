import type { NoteTypeKind } from '@anki-duo/domain';
import type { schema } from '../db/client.js';

const iso = (d: Date | null) => (d ? d.toISOString() : null);

type DeckRow = typeof schema.deck.$inferSelect;
type CardRow = typeof schema.card.$inferSelect;
type NoteTypeRow = typeof schema.noteType.$inferSelect;
type MediaRow = typeof schema.mediaAsset.$inferSelect;
type StatsRow = typeof schema.learnerStats.$inferSelect;
type DailyRow = typeof schema.dailyActivity.$inferSelect;

export const toDeck = (r: DeckRow) => ({
  id: r.id,
  name: r.name,
  newCardsPerDay: r.newCardsPerDay,
  mcPractice: r.mcPractice,
  createdAt: r.createdAt.toISOString(),
  updatedAt: r.updatedAt.toISOString(),
  deletedAt: iso(r.deletedAt),
});

export const toCard = (r: CardRow) => ({
  id: r.id,
  deckId: r.deckId,
  position: r.position,
  nodeIndex: r.nodeIndex,
  front: r.front,
  back: r.back,
  tags: r.tags,
  suspended: r.suspended,
  noteId: r.noteId,
  noteTypeId: r.noteTypeId,
  templateId: r.templateId,
  ordinal: r.ordinal,
  interaction: r.interaction ?? null,
  answerText: r.answerText,
  format: r.format as 'markdown' | 'html',
  fsrs: {
    state: r.state as 'new' | 'learning' | 'review' | 'relearning',
    due: r.due.toISOString(),
    stability: r.stability,
    difficulty: r.difficulty,
    learningSteps: r.learningSteps,
    reps: r.reps,
    lapses: r.lapses,
    lastReview: iso(r.lastReview),
  },
  updatedAt: r.updatedAt.toISOString(),
  deletedAt: iso(r.deletedAt),
});

export const toMedia = (r: MediaRow) => ({
  id: r.id,
  cardId: r.cardId,
  side: r.side as 'front' | 'back',
  kind: r.kind as 'image' | 'audio',
  mime: r.mime,
  bytes: r.bytes,
  sort: r.sort,
  deletedAt: iso(r.deletedAt),
});

export const toStats = (r: StatsRow) => ({
  totalXp: r.totalXp,
  currentStreak: r.currentStreak,
  longestStreak: r.longestStreak,
  lastGoalDay: r.lastGoalDay,
  cardCount: r.cardCount,
  mediaBytes: r.mediaBytes,
});

export const toDaily = (r: DailyRow) => ({
  studyDay: r.studyDay,
  reviews: r.reviews,
  xp: r.xp,
  goalXp: r.goalXp,
  allAvailableDone: r.allAvailableDone,
  goalMet: r.goalMet,
});

/** Tombstones (deleted note types) carry no content. */
export const toNoteType = (r: NoteTypeRow) => ({
  id: r.id,
  name: r.name,
  fields: r.deletedAt ? [] : r.fields,
  templates: r.deletedAt ? [] : r.templates,
  css: r.deletedAt ? '' : r.css,
  kind: r.kind as NoteTypeKind,
  options: r.deletedAt ? {} : r.options,
  builtinKey: r.builtinKey,
  updatedAt: r.updatedAt.toISOString(),
  deletedAt: iso(r.deletedAt),
});
