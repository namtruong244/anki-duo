import { createRoute, z } from '@hono/zod-openapi';
import { CardSchema, DeckSchema, TagSchema, problemResponse } from './common.js';

const deckId = z.uuid().openapi({ param: { name: 'deckId', in: 'path', required: true } });
const cardId = z.uuid().openapi({ param: { name: 'cardId', in: 'path', required: true } });

const deckName = z.string().trim().min(1).max(100);
const front = z.string().trim().min(1).max(10_000);
const back = z.string().max(10_000);
const tags = z.array(TagSchema).max(20);
const atLeastOne = (v: object) => Object.values(v).some((x) => x !== undefined);

// --- Decks ----------------------------------------------------------------------------------

export const createDeckRoute = createRoute({
  method: 'post',
  path: '/decks',
  summary: 'Create a deck',
  request: {
    body: {
      required: true,
      content: {
        'application/json': {
          schema: z.object({
            id: z.uuid().optional().openapi({ description: 'Optional client id' }),
            name: deckName,
            newCardsPerDay: z.number().int().min(0).max(999).default(20).optional(),
          }),
        },
      },
    },
  },
  responses: {
    201: { description: 'Created', content: { 'application/json': { schema: DeckSchema } } },
    409: problemResponse('Error'),
  },
});

export const patchDeckRoute = createRoute({
  method: 'patch',
  path: '/decks/{deckId}',
  summary: 'Rename a deck or change its new-card limit',
  request: {
    params: z.object({ deckId }),
    body: {
      required: true,
      content: {
        'application/json': {
          schema: z
            .object({
              name: deckName.optional(),
              newCardsPerDay: z.number().int().min(0).max(999).optional(),
            })
            .refine(atLeastOne, { message: 'at least one field is required' })
            .openapi({ minProperties: 1 }),
        },
      },
    },
  },
  responses: {
    200: { description: 'Updated', content: { 'application/json': { schema: DeckSchema } } },
    404: problemResponse('Error'),
    409: problemResponse('Error'),
  },
});

export const deleteDeckRoute = createRoute({
  method: 'delete',
  path: '/decks/{deckId}',
  summary: 'Delete a deck with all its cards, media and history',
  description: 'The client must have shown a confirmation first. Irreversible.',
  request: { params: z.object({ deckId }) },
  responses: { 204: { description: 'Deleted' }, 404: problemResponse('Error') },
});

// --- Cards ----------------------------------------------------------------------------------

export const CardInputSchema = z
  .object({
    id: z.uuid().optional().openapi({ description: 'Optional client id (create only)' }),
    front,
    back: back.optional(),
    tags: tags.optional(),
  })
  .openapi('CardInput');

export const createCardRoute = createRoute({
  method: 'post',
  path: '/decks/{deckId}/cards',
  summary: 'Create a card',
  request: {
    params: z.object({ deckId }),
    body: { required: true, content: { 'application/json': { schema: CardInputSchema } } },
  },
  responses: {
    201: { description: 'Created', content: { 'application/json': { schema: CardSchema } } },
    422: problemResponse('Error'),
  },
});

export const patchCardRoute = createRoute({
  method: 'patch',
  path: '/cards/{cardId}',
  summary: 'Edit card content, tags or suspension',
  description: 'Editing content never changes scheduling state.',
  request: {
    params: z.object({ cardId }),
    body: {
      required: true,
      content: {
        'application/json': {
          schema: z
            .object({
              front: front.optional(),
              back: back.optional(),
              tags: tags.optional(),
              suspended: z.boolean().optional(),
            })
            .refine(atLeastOne, { message: 'at least one field is required' })
            .openapi({ minProperties: 1 }),
        },
      },
    },
  },
  responses: {
    200: { description: 'Updated', content: { 'application/json': { schema: CardSchema } } },
    404: problemResponse('Error'),
    409: problemResponse('Error'),
  },
});

export const deleteCardRoute = createRoute({
  method: 'delete',
  path: '/cards/{cardId}',
  summary: 'Delete a card and its media and history',
  request: { params: z.object({ cardId }) },
  responses: { 204: { description: 'Deleted' } },
});

export const resetCardRoute = createRoute({
  method: 'post',
  path: '/cards/{cardId}/reset',
  summary: 'Reset a card to New (records a ReviewLog of kind=reset)',
  request: { params: z.object({ cardId }) },
  responses: {
    200: { description: 'Reset', content: { 'application/json': { schema: CardSchema } } },
  },
});

// --- Import ---------------------------------------------------------------------------------

export const ImportChunkSchema = z.object({
  jobId: z.uuid(),
  fileName: z.string().max(255),
  // Over-limit totals must answer 413 import_too_large, not a generic validation error.
  totalRows: z.number().int().min(1).openapi({ maximum: 10_000 }),
  chunkIndex: z.number().int().min(0),
  isLast: z.boolean().default(false).optional(),
  duplicateMode: z.enum(['skip', 'update', 'keep_both']),
  rows: z
    .array(
      z.object({
        row: z
          .number()
          .int()
          .min(1)
          .openapi({ description: '1-based line number in the source file' }),
        // Length is checked per row so one bad row is reported instead of failing the chunk.
        front: z.string(),
        back: z.string().default('').optional(),
        tags: z.array(z.string()).optional(),
      }),
    )
    .max(1000),
});

export const ImportResultSchema = z.object({
  imported: z.number().int(),
  updated: z.number().int(),
  skipped: z.number().int(),
  errors: z.array(z.object({ row: z.number().int(), reason: z.string() })),
});

export const importRoute = createRoute({
  method: 'post',
  path: '/decks/{deckId}/import',
  summary: 'Import one chunk of parsed CSV/TSV rows',
  description: 'See contracts/csv-import.md. Send chunks in order with the same jobId.',
  request: {
    params: z.object({ deckId }),
    body: { required: true, content: { 'application/json': { schema: ImportChunkSchema } } },
  },
  responses: {
    200: {
      description: 'Chunk result (cumulative totals for the job)',
      content: { 'application/json': { schema: ImportResultSchema } },
    },
    413: problemResponse('Error'),
    422: problemResponse('Error'),
  },
});

export const deckRoutes = [
  createDeckRoute,
  patchDeckRoute,
  deleteDeckRoute,
  createCardRoute,
  patchCardRoute,
  deleteCardRoute,
  resetCardRoute,
  importRoute,
];
