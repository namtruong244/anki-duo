import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { user } from './learner.js';

export const deck = pgTable(
  'deck',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    newCardsPerDay: smallint('new_cards_per_day').notNull().default(20),
    nextPosition: integer('next_position').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    changeSeq: bigint('change_seq', { mode: 'number' }),
  },
  (t) => [
    // Name is 1-100 chars after trimming and unique per user among live decks, ignoring case.
    check(
      'deck_name_length',
      sql`${t.deletedAt} is not null or char_length(${t.name}) between 1 and 100`,
    ),
    check('deck_new_cards_per_day', sql`${t.newCardsPerDay} between 0 and 999`),
    uniqueIndex('deck_user_name_unique')
      .on(t.userId, sql`lower(${t.name})`)
      .where(sql`${t.deletedAt} is null`),
    index('deck_user_seq_idx').on(t.userId, t.changeSeq),
  ],
);

export const noteType = pgTable(
  'note_type',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    fields: jsonb('fields').notNull().$type<{ id: string; name: string }[]>(),
    templates: jsonb('templates')
      .notNull()
      .$type<{ id: string; name: string; front: string; back: string }[]>(),
    css: text('css').notNull().default(''),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    changeSeq: bigint('change_seq', { mode: 'number' }),
  },
  (t) => [
    check(
      'note_type_name_length',
      sql`${t.deletedAt} is not null or char_length(${t.name}) between 1 and 100`,
    ),
    uniqueIndex('note_type_user_name_unique')
      .on(t.userId, sql`lower(${t.name})`)
      .where(sql`${t.deletedAt} is null`),
    index('note_type_user_seq_idx').on(t.userId, t.changeSeq),
  ],
);

export const note = pgTable(
  'note',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    deckId: uuid('deck_id')
      .notNull()
      .references(() => deck.id, { onDelete: 'cascade' }),
    noteTypeId: uuid('note_type_id')
      .notNull()
      .references(() => noteType.id),
    fields: jsonb('fields').notNull().$type<Record<string, string>>(),
    tags: text('tags')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    index('note_deck_idx').on(t.deckId),
    index('note_type_idx').on(t.noteTypeId),
    index('note_user_idx').on(t.userId),
  ],
);

export const card = pgTable(
  'card',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    deckId: uuid('deck_id')
      .notNull()
      .references(() => deck.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    nodeIndex: integer('node_index').notNull(),
    front: text('front').notNull().default(''),
    back: text('back').notNull().default(''),
    frontNorm: text('front_norm').notNull().default(''),
    noteId: uuid('note_id').references(() => note.id, { onDelete: 'cascade' }),
    noteTypeId: uuid('note_type_id'),
    templateId: text('template_id'),
    format: text('format').notNull().default('markdown'),
    tags: text('tags')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    state: text('state').notNull().default('new'),
    due: timestamp('due', { withTimezone: true }).notNull().defaultNow(),
    stability: doublePrecision('stability').notNull().default(0),
    difficulty: doublePrecision('difficulty').notNull().default(0),
    learningSteps: smallint('learning_steps').notNull().default(0),
    reps: integer('reps').notNull().default(0),
    lapses: integer('lapses').notNull().default(0),
    lastReview: timestamp('last_review', { withTimezone: true }),
    suspended: boolean('suspended').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    changeSeq: bigint('change_seq', { mode: 'number' }),
  },
  (t) => [
    // Content is cleared on deletion, so the length checks only apply to live rows.
    check(
      'card_front_length',
      sql`${t.deletedAt} is not null or char_length(${t.front}) between 1 and 100000`,
    ),
    check('card_back_length', sql`char_length(${t.back}) <= 100000`),
    check('card_tags_count', sql`cardinality(${t.tags}) <= 20`),
    check('card_format', sql`${t.format} in ('markdown', 'html')`),
    check('card_state', sql`${t.state} in ('new', 'learning', 'review', 'relearning')`),
    check('card_difficulty', sql`${t.difficulty} between 0 and 10`),
    check('card_stability', sql`${t.stability} >= 0`),
    index('card_queue_idx').on(t.userId, t.deckId, t.state, t.due),
    index('card_node_idx').on(t.deckId, t.nodeIndex),
    index('card_front_norm_idx').on(t.deckId, t.frontNorm),
    index('card_user_seq_idx').on(t.userId, t.changeSeq),
    index('card_note_idx').on(t.noteId),
    uniqueIndex('card_note_template_unique')
      .on(t.noteId, t.templateId)
      .where(sql`${t.deletedAt} is null and ${t.noteId} is not null`),
  ],
);

export const mediaAsset = pgTable(
  'media_asset',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    cardId: uuid('card_id')
      .notNull()
      .references(() => card.id, { onDelete: 'cascade' }),
    side: text('side').notNull(),
    kind: text('kind').notNull(),
    mime: text('mime').notNull(),
    bytes: integer('bytes').notNull(),
    storageKey: text('storage_key').notNull(),
    status: text('status').notNull().default('pending'),
    sort: smallint('sort').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    changeSeq: bigint('change_seq', { mode: 'number' }),
  },
  (t) => [
    check('media_asset_bytes', sql`${t.bytes} between 1 and 5242880`),
    check('media_asset_status', sql`${t.status} in ('pending', 'ready')`),
    check('media_asset_side', sql`${t.side} in ('front', 'back')`),
    check('media_asset_kind', sql`${t.kind} in ('image', 'audio')`),
    index('media_asset_card_idx').on(t.cardId),
    index('media_asset_user_seq_idx').on(t.userId, t.changeSeq),
  ],
);
