import { createRoute, z } from '@hono/zod-openapi';
import { DeckSchema, problemResponse } from './common.js';

const DeckIdParams = z.object({
  deckId: z.uuid().openapi({ param: { name: 'deckId', in: 'path', required: true } }),
});

// The document itself is specified in contracts/export-format.md and checked by the domain.
const ExportFile = z.any().openapi({ description: 'See contracts/export-format.md' });

export const exportDeckRoute = createRoute({
  method: 'get',
  path: '/decks/{deckId}/export',
  summary: 'Export a deck in anki-duo-export v1 format',
  request: { params: DeckIdParams },
  responses: {
    200: {
      description: 'Export file (Content-Disposition attachment)',
      content: { 'application/json': { schema: ExportFile } },
    },
  },
});

export const restoreDeckRoute = createRoute({
  method: 'post',
  path: '/decks/restore',
  summary: 'Create a new deck from an anki-duo-export v1 file',
  request: { body: { required: true, content: { 'application/json': { schema: ExportFile } } } },
  responses: {
    201: { description: 'Restored', content: { 'application/json': { schema: DeckSchema } } },
    422: problemResponse('Error'),
  },
});

export const exportRoutes = [exportDeckRoute, restoreDeckRoute];
