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
  'cards_would_be_removed',
  'too_many_cards',
  'cloze_required',
  'wrong_answers_required',
  'occlusion_masks_required',
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
    count: z
      .number()
      .int()
      .optional()
      .openapi({ description: 'cards_would_be_removed: number of reviewed cards that vanish' }),
    cards: z
      .array(
        z.object({
          id: z.uuid(),
          templateId: z.string(),
          ordinal: z.number().int().min(0),
          reps: z.number().int().min(0),
        }),
      )
      .optional()
      .openapi({ description: 'cards_would_be_removed: only the reviewed vanished cards' }),
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

export const MaskSchema = z
  .object({
    n: z.number().int().min(1),
    shape: z.enum(['rect', 'ellipse']),
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    w: z.number().gt(0).max(1),
    h: z.number().gt(0).max(1),
    label: z.string().optional(),
  })
  .openapi('Mask');

const OcclusionModeSchema = z.enum(['hide_all', 'hide_one']);

export const NoteExtraSchema = z
  .object({
    occlusion: z.object({ mode: OcclusionModeSchema, masks: z.array(MaskSchema) }).optional(),
  })
  .openapi('NoteExtra');

export const SlotSchema = z
  .discriminatedUnion('kind', [
    z.object({ kind: z.literal('type') }),
    z.object({ kind: z.literal('choice') }),
    z.object({ kind: z.literal('occlusion') }),
    z.object({ kind: z.literal('tts'), lang: z.string(), text: z.string() }),
  ])
  .openapi('Slot');

export const AnswerSchema = z
  .discriminatedUnion('kind', [
    z.object({
      kind: z.literal('type'),
      expected: z.string(),
      ignoreCase: z.boolean(),
      ignoreDiacritics: z.boolean(),
    }),
    z.object({
      kind: z.literal('choice'),
      correct: z.string(),
      wrong: z.array(z.string()),
      explanationHtml: z.string(),
    }),
    z.object({
      kind: z.literal('occlusion'),
      image: z.string(),
      mode: OcclusionModeSchema,
      masks: z.array(MaskSchema),
      target: z.number().int().min(1),
    }),
  ])
  .openapi('Answer');

/** Output only: produced by the server's renderCard, never accepted from clients. */
export const InteractionSchema = z
  .object({
    v: z.literal(1),
    slots: z.array(SlotSchema),
    answer: z.union([AnswerSchema, z.null()]),
  })
  .openapi('Interaction');

export const NoteTypeKindSchema = z.enum([
  'standard',
  'cloze',
  'image_occlusion',
  'multiple_choice',
]);

export const NoteTypeOptionsSchema = z
  .object({
    typeIgnoreCase: z.boolean().optional(),
    typeIgnoreDiacritics: z.boolean().optional(),
    roles: z
      .object({
        correct: z.string(),
        wrong: z.string(),
        explanation: z.string(),
      })
      .optional()
      .openapi({ description: 'Field ids; required for multiple_choice' }),
  })
  .openapi('NoteTypeOptions');

export const DeckSchema = z
  .object({
    id: z.uuid(),
    name: z.string(),
    newCardsPerDay: z.number().int(),
    mcPractice: z.boolean(),
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
    ordinal: z.number().int().min(0),
    interaction: z.union([InteractionSchema, z.null()]),
    answerText: z.string(),
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
    kind: NoteTypeKindSchema,
    options: NoteTypeOptionsSchema,
    builtinKey: z.string().nullable(),
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
    extra: z.union([NoteExtraSchema, z.null()]),
    cards: z.array(
      z.object({ id: z.uuid(), templateId: z.string(), ordinal: z.number().int().min(0) }),
    ),
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
  autoGrade: z.boolean(),
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
