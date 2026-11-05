import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { card, deck } from './content.js';
import { user } from './learner.js';

export const studySession = pgTable(
  'study_session',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    deckId: uuid('deck_id')
      .notNull()
      .references(() => deck.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    nodeIndex: integer('node_index'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    plannedCount: smallint('planned_count').notNull().default(0),
    cardsReviewed: smallint('cards_reviewed').notNull().default(0),
    correctCount: smallint('correct_count').notNull().default(0),
    completed: boolean('completed').notNull().default(false),
    bonusXp: smallint('bonus_xp').notNull().default(0),
    studyDay: date('study_day', { mode: 'string' }).notNull(),
  },
  (t) => [
    check('study_session_kind', sql`${t.kind} in ('node', 'review', 'ahead')`),
    check('study_session_node', sql`${t.kind} <> 'node' or ${t.nodeIndex} is not null`),
    index('study_session_user_day_idx').on(t.userId, t.studyDay),
  ],
);

/** Append-only. Rows are never updated except to set `revoked_at` once. */
export const reviewLog = pgTable(
  'review_log',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    cardId: uuid('card_id')
      .notNull()
      .references(() => card.id, { onDelete: 'cascade' }),
    deckId: uuid('deck_id')
      .notNull()
      .references(() => deck.id, { onDelete: 'cascade' }),
    sessionId: uuid('session_id'),
    kind: text('kind').notNull().default('review'),
    grade: smallint('grade'),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }).notNull(),
    durationMs: integer('duration_ms').notNull().default(0),
    wasNew: boolean('was_new').notNull().default(false),
    wasDue: boolean('was_due').notNull().default(false),
    studyAhead: boolean('study_ahead').notNull().default(false),
    xp: smallint('xp').notNull().default(0),
    stateBefore: doublePrecision('state_before').array().notNull(),
    stateAfter: doublePrecision('state_after').array().notNull(),
    schedulerVersion: text('scheduler_version').notNull(),
    // The parameters this review was scheduled with, so a replay never rewrites history when the
    // learner later changes their settings (FR-004).
    desiredRetention: numeric('desired_retention', { precision: 3, scale: 2 })
      .notNull()
      .default('0.90'),
    maximumIntervalDays: integer('maximum_interval_days').notNull().default(36500),
    deviceId: uuid('device_id'),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
    changeSeq: bigint('change_seq', { mode: 'number' }),
  },
  (t) => [
    check('review_log_kind', sql`${t.kind} in ('review', 'reset')`),
    check(
      'review_log_grade',
      sql`(${t.kind} = 'review' and ${t.grade} between 1 and 4) or ${t.kind} = 'reset'`,
    ),
    check('review_log_duration', sql`${t.durationMs} between 0 and 3600000`),
    check(
      'review_log_state_len',
      sql`cardinality(${t.stateBefore}) = 8 and cardinality(${t.stateAfter}) = 8`,
    ),
    index('review_log_card_idx').on(t.cardId, t.reviewedAt, t.id),
    index('review_log_user_day_idx').on(t.userId, t.reviewedAt),
  ],
);

export const dailyActivity = pgTable(
  'daily_activity',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    studyDay: date('study_day', { mode: 'string' }).notNull(),
    reviews: integer('reviews').notNull().default(0),
    xp: integer('xp').notNull().default(0),
    goalXp: smallint('goal_xp').notNull().default(20),
    allAvailableDone: boolean('all_available_done').notNull().default(false),
    goalMet: boolean('goal_met').notNull().default(false),
    changeSeq: bigint('change_seq', { mode: 'number' }),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.studyDay] }),
    index('daily_activity_seq_idx').on(t.userId, t.changeSeq),
  ],
);

export const importJob = pgTable(
  'import_job',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    deckId: uuid('deck_id')
      .notNull()
      .references(() => deck.id, { onDelete: 'cascade' }),
    fileName: text('file_name').notNull(),
    totalRows: integer('total_rows').notNull(),
    mapping: jsonb('mapping'),
    duplicateMode: text('duplicate_mode').notNull(),
    imported: integer('imported').notNull().default(0),
    updated: integer('updated').notNull().default(0),
    skipped: integer('skipped').notNull().default(0),
    errors: jsonb('errors')
      .notNull()
      .default(sql`'[]'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (t) => [
    check('import_job_rows', sql`${t.totalRows} between 1 and 10000`),
    check('import_job_mode', sql`${t.duplicateMode} in ('skip', 'update', 'keep_both')`),
  ],
);

export const rateLimitBucket = pgTable(
  'rate_limit_bucket',
  {
    key: text('key').notNull(),
    windowStart: timestamp('window_start', { withTimezone: true }).notNull(),
    count: integer('count').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.key, t.windowStart] })],
);
