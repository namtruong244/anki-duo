import { createRoute, z } from '@hono/zod-openapi';
import {
  FsrsStateSchema,
  CardSchema,
  DailyActivitySchema,
  DeckSchema,
  MediaSchema,
  SettingsSchema,
  StatsSchema,
  problemResponse,
} from './common.js';

export const PullQuerySchema = z.object({
  cursor: z.string().regex(/^[0-9]+$/),
  limit: z.coerce.number().int().min(1).max(2000).default(1000).optional(),
  deviceId: z.uuid(),
});

export const PullResponseSchema = z.object({
  cursor: z.string(),
  hasMore: z.boolean(),
  settings: z.union([SettingsSchema, z.null()]),
  stats: z.union([StatsSchema, z.null()]),
  decks: z.array(DeckSchema),
  cards: z.array(CardSchema),
  media: z.array(MediaSchema),
  dailyActivity: z.array(DailyActivitySchema),
});

export const pullRoute = createRoute({
  method: 'get',
  path: '/sync/pull',
  summary: 'Fetch every change since a cursor',
  request: { query: PullQuerySchema },
  responses: {
    200: {
      description: 'Changes',
      content: { 'application/json': { schema: PullResponseSchema } },
    },
    400: problemResponse('Error'),
  },
});

// --- Push ---------------------------------------------------------------------------------------

const isoDate = z.iso.datetime();

export const ReviewEventSchema = z
  .object({
    type: z.literal('review'),
    id: z.uuid().openapi({ description: 'UUIDv7 generated on device' }),
    cardId: z.uuid(),
    sessionId: z.uuid(),
    // Documented as 1-4 but not enforced here: an out-of-range grade must reject that one event
    // (`invalid_grade`), not fail the whole batch.
    grade: z
      .number()
      .openapi({
        type: 'integer',
        enum: [1, 2, 3, 4],
        description: '1 Again, 2 Hard, 3 Good, 4 Easy',
      }),
    reviewedAt: isoDate,
    durationMs: z.number().int().min(0),
    studyAhead: z.boolean().default(false).optional(),
    schedulerVersion: z.string(),
    stateBefore: FsrsStateSchema,
    stateAfter: FsrsStateSchema, // the client's optimistic result; the server recomputes it
  })
  .openapi('ReviewEvent');

export const RevokeEventSchema = z
  .object({ type: z.literal('revoke'), id: z.uuid(), reviewId: z.uuid(), revokedAt: isoDate })
  .openapi('RevokeEvent');

export const SessionEventSchema = z
  .object({
    type: z.literal('session'),
    id: z.uuid().openapi({ description: 'Equals StudySession.id. Re-sent with updates' }),
    deckId: z.uuid(),
    kind: z.enum(['node', 'review', 'ahead']),
    nodeIndex: z.number().int().nullable().optional(),
    startedAt: isoDate,
    endedAt: isoDate.nullable().optional(),
    plannedCount: z.number().int().min(0),
    cardsReviewed: z.number().int().min(0),
    correctCount: z.number().int().min(0),
    completed: z.boolean(),
  })
  .openapi('SessionEvent');

export const DayFlagEventSchema = z
  .object({
    type: z.literal('day_flag'),
    id: z.uuid(),
    studyDay: z.iso.date(),
    allAvailableDone: z.literal(true),
  })
  .openapi('DayFlagEvent');

export const PushEventSchema = z.discriminatedUnion('type', [
  ReviewEventSchema,
  RevokeEventSchema,
  SessionEventSchema,
  DayFlagEventSchema,
]);
export type PushEvent = z.infer<typeof PushEventSchema>;

export const PUSH_REJECT_CODES = [
  'card_not_found',
  'future_timestamp',
  'invalid_grade',
  'review_not_found',
] as const;

export const PushRequestSchema = z.object({
  deviceId: z.uuid(),
  events: z.array(PushEventSchema).max(500),
});

export const PushResultSchema = z.object({
  id: z.uuid(),
  status: z.enum(['applied', 'duplicate', 'rejected']),
  code: z
    .enum(PUSH_REJECT_CODES)
    .optional()
    .openapi({ description: 'Set when rejected. Rejected events must not be retried.' }),
});

export const pushRoute = createRoute({
  method: 'post',
  path: '/sync/push',
  summary: 'Upload outbox events (reviews, revokes, sessions, day flags)',
  request: {
    body: { required: true, content: { 'application/json': { schema: PushRequestSchema } } },
  },
  responses: {
    200: {
      description: 'Per-event results',
      content: { 'application/json': { schema: z.object({ results: z.array(PushResultSchema) }) } },
    },
    400: problemResponse('Error'),
    429: problemResponse('Error'),
  },
});
