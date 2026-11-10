import { z } from '@hono/zod-openapi';

export const PROBLEM_CODES = [
  'validation_failed',
  'not_found',
  'deck_name_taken',
  'card_limit_reached',
  'media_quota_exceeded',
  'media_too_large',
  'unsupported_media_type',
  'import_too_large',
  'import_bad_encoding',
  'export_invalid',
  'invalid_note_type',
  'note_type_in_use',
  'note_type_name_taken',
  'empty_front',
  'edit_via_note',
  'rate_limited',
  'reauth_required',
] as const;
export type ProblemCode = (typeof PROBLEM_CODES)[number];

export const ProblemSchema = z
  .object({
    type: z.string(),
    title: z.string(),
    status: z.number().int(),
    code: z.enum(PROBLEM_CODES),
    detail: z.string().optional(),
    errors: z
      .array(z.object({ path: z.string().optional(), message: z.string().optional() }))
      .optional(),
  })
  .openapi('Problem');

export const FsrsStateSchema = z
  .object({
    state: z.enum(['new', 'learning', 'review', 'relearning']),
    due: z.iso.datetime(),
    stability: z.number().min(0),
    difficulty: z.number().min(0).max(10),
    learningSteps: z.number().int().min(0),
    reps: z.number().int().min(0),
    lapses: z.number().int().min(0),
    lastReview: z.iso.datetime().nullable(),
  })
  .openapi('FsrsState');

const nullableDate = z.iso.datetime().nullable();

export const DeckSchema = z
  .object({
    id: z.uuid(),
    name: z.string(),
    newCardsPerDay: z.number().int(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    deletedAt: nullableDate,
  })
  .openapi('Deck');

export const TagSchema = z.string().min(1).max(50).regex(/^\S+$/);

export const CardSchema = z
  .object({
    id: z.uuid(),
    deckId: z.uuid(),
    position: z.number().int(),
    nodeIndex: z.number().int(),
    front: z.string(),
    back: z.string(),
    tags: z.array(z.string()),
    suspended: z.boolean(),
    noteId: z.uuid().nullable(),
    noteTypeId: z.uuid().nullable(),
    templateId: z.string().nullable(),
    format: z.enum(['markdown', 'html']),
    fsrs: FsrsStateSchema,
    updatedAt: z.iso.datetime(),
    deletedAt: nullableDate,
  })
  .openapi('Card');

export const NoteFieldSchema = z.object({ id: z.string(), name: z.string() }).openapi('NoteField');

export const NoteTemplateSchema = z
  .object({ id: z.string(), name: z.string(), front: z.string(), back: z.string() })
  .openapi('NoteTemplate');

export const NoteTypeSchema = z
  .object({
    id: z.uuid(),
    name: z.string(),
    fields: z.array(NoteFieldSchema),
    templates: z.array(NoteTemplateSchema),
    css: z.string(),
    updatedAt: z.iso.datetime(),
    deletedAt: nullableDate,
  })
  .openapi('NoteType');

export const NoteSchema = z
  .object({
    id: z.uuid(),
    deckId: z.uuid(),
    noteTypeId: z.uuid(),
    fields: z.record(z.string(), z.string()),
    tags: z.array(z.string()),
    cards: z.array(z.object({ id: z.uuid(), templateId: z.string() })),
    updatedAt: z.iso.datetime(),
  })
  .openapi('Note');

export const MediaSchema = z
  .object({
    id: z.uuid(),
    cardId: z.uuid(),
    side: z.enum(['front', 'back']),
    kind: z.enum(['image', 'audio']),
    mime: z.string(),
    bytes: z.number().int(),
    sort: z.number().int(),
    deletedAt: nullableDate,
  })
  .openapi('Media');

function isIanaZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export const SettingsFields = {
  locale: z.enum(['vi', 'en']),
  timeZone: z.string().refine(isIanaZone, { message: 'must be an IANA time zone' }),
  dayStartHour: z.number().int().min(0).max(23),
  desiredRetention: z.number().min(0.7).max(0.97),
  maximumIntervalDays: z.number().int().min(1).max(36500),
  dailyXpGoal: z
    .number()
    .int()
    .refine((v) => [10, 20, 30, 50].includes(v), { message: 'must be one of 10, 20, 30, 50' })
    .openapi({ enum: [10, 20, 30, 50] }),
  sessionSize: z.number().int().min(5).max(50),
  soundEnabled: z.boolean(),
  motion: z.enum(['system', 'reduced', 'full']),
};

export const SettingsSchema = z.object(SettingsFields).openapi('Settings');

export const SettingsPatchSchema = z
  .object(SettingsFields)
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'at least one field is required' })
  .openapi('SettingsPatch', { minProperties: 1 });

export const StatsSchema = z
  .object({
    totalXp: z.number().int(),
    currentStreak: z.number().int(),
    longestStreak: z.number().int(),
    lastGoalDay: z.iso.date().nullable(),
    cardCount: z.number().int().max(20000),
    mediaBytes: z.number().int(),
  })
  .openapi('Stats');

export const DailyActivitySchema = z
  .object({
    studyDay: z.iso.date(),
    reviews: z.number().int(),
    xp: z.number().int(),
    goalXp: z.number().int(),
    allAvailableDone: z.boolean(),
    goalMet: z.boolean(),
  })
  .openapi('DailyActivity');

export const SECURITY = [{ sessionCookie: [] }, { bearerSession: [] }];
export const securitySchemes = {
  sessionCookie: {
    type: 'apiKey' as const,
    in: 'cookie' as const,
    name: 'better-auth.session_token',
    description:
      'Session cookie set by Better Auth (httpOnly, Secure, SameSite=Lax). Web app only.',
  },
  bearerSession: {
    type: 'http' as const,
    scheme: 'bearer',
    description: 'Better Auth session token (bearer plugin). Native clients, such as Flutter.',
  },
};

/** A standard `application/problem+json` response entry. */
export const problemResponse = (description: string) => ({
  description,
  content: { 'application/problem+json': { schema: ProblemSchema } },
});
