import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  numeric,
  pgTable,
  smallint,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

// --- Better Auth tables (research R4) -------------------------------------------------------

export const user = pgTable('user', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const session = pgTable(
  'session',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    token: text('token').notNull().unique(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
  },
  (t) => [index('session_user_idx').on(t.userId)],
);

export const account = pgTable(
  'account',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }),
    scope: text('scope'),
    password: text('password'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('account_user_idx').on(t.userId)],
);

export const verification = pgTable('verification', {
  id: uuid('id').primaryKey().defaultRandom(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// --- Learner ----------------------------------------------------------------------------------

export const learnerSettings = pgTable(
  'learner_settings',
  {
    userId: uuid('user_id')
      .primaryKey()
      .references(() => user.id, { onDelete: 'cascade' }),
    locale: text('locale').notNull().default('en'),
    timeZone: text('time_zone').notNull().default('UTC'),
    dayStartHour: smallint('day_start_hour').notNull().default(4),
    desiredRetention: numeric('desired_retention', { precision: 3, scale: 2 })
      .notNull()
      .default('0.90'),
    maximumIntervalDays: integer('maximum_interval_days').notNull().default(36500),
    dailyXpGoal: smallint('daily_xp_goal').notNull().default(20),
    sessionSize: smallint('session_size').notNull().default(20),
    soundEnabled: boolean('sound_enabled').notNull().default(true),
    motion: text('motion').notNull().default('system'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    changeSeq: bigint('change_seq', { mode: 'number' }),
  },
  (t) => [
    check('learner_settings_locale', sql`${t.locale} in ('vi', 'en')`),
    check('learner_settings_day_start', sql`${t.dayStartHour} between 0 and 23`),
    check('learner_settings_retention', sql`${t.desiredRetention} between 0.70 and 0.97`),
    check('learner_settings_max_interval', sql`${t.maximumIntervalDays} between 1 and 36500`),
    check('learner_settings_goal', sql`${t.dailyXpGoal} in (10, 20, 30, 50)`),
    check('learner_settings_session_size', sql`${t.sessionSize} between 5 and 50`),
    check('learner_settings_motion', sql`${t.motion} in ('system', 'reduced', 'full')`),
    index('learner_settings_seq_idx').on(t.userId, t.changeSeq),
  ],
);

export const learnerStats = pgTable(
  'learner_stats',
  {
    userId: uuid('user_id')
      .primaryKey()
      .references(() => user.id, { onDelete: 'cascade' }),
    totalXp: integer('total_xp').notNull().default(0),
    currentStreak: integer('current_streak').notNull().default(0),
    longestStreak: integer('longest_streak').notNull().default(0),
    lastGoalDay: date('last_goal_day', { mode: 'string' }),
    cardCount: integer('card_count').notNull().default(0),
    mediaBytes: bigint('media_bytes', { mode: 'number' }).notNull().default(0),
    changeSeq: bigint('change_seq', { mode: 'number' }),
  },
  (t) => [
    check('learner_stats_card_count', sql`${t.cardCount} between 0 and 20000`),
    check('learner_stats_media_bytes', sql`${t.mediaBytes} between 0 and 524288000`),
  ],
);

export const device = pgTable(
  'device',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    label: text('label').notNull().default(''),
    lastPullSeq: bigint('last_pull_seq', { mode: 'number' }).notNull().default(0),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('device_user_idx').on(t.userId)],
);
