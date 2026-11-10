import { createRoute, z } from '@hono/zod-openapi';
import {
  NoteExtraSchema,
  NoteSchema,
  NoteTypeKindSchema,
  NoteTypeOptionsSchema,
  NoteTypeSchema,
  TagSchema,
  problemResponse,
} from './common.js';

const noteTypeId = z.uuid().openapi({ param: { name: 'noteTypeId', in: 'path', required: true } });
const noteId = z.uuid().openapi({ param: { name: 'noteId', in: 'path', required: true } });
const deckId = z.uuid().openapi({ param: { name: 'deckId', in: 'path', required: true } });

const atLeastOne = (v: object) => Object.values(v).some((x) => x !== undefined);

const fieldInput = z.object({
  id: z.string().min(1).max(40),
  name: z.string().min(1).max(100),
});
const templateInput = z.object({
  id: z.string().min(1).max(40),
  name: z.string().min(1).max(100),
  front: z.string().max(20_000),
  back: z.string().max(20_000),
});
const fieldsInput = z.array(fieldInput).min(1).max(50);
const templatesInput = z.array(templateInput).min(1).max(20);
const css = z.string().max(50_000);
const noteTypeName = z.string().trim().min(1).max(100);
const confirmRemoval = z.boolean().openapi({
  description:
    'Set after the learner confirmed that reviewed cards will be removed (409 cards_would_be_removed)',
});
const fieldValues = z.record(z.string(), z.string().max(100_000));

// --- Note types -------------------------------------------------------------------------------

export const listNoteTypesRoute = createRoute({
  method: 'get',
  path: '/note-types',
  summary: 'List note types',
  description: 'Creates the default note types the first time a learner has none.',
  responses: {
    200: {
      description: 'Note types',
      content: {
        'application/json': { schema: z.object({ noteTypes: z.array(NoteTypeSchema) }) },
      },
    },
  },
});

export const createNoteTypeRoute = createRoute({
  method: 'post',
  path: '/note-types',
  summary: 'Create a note type',
  request: {
    body: {
      required: true,
      content: {
        'application/json': {
          schema: z.object({
            id: z.uuid().optional().openapi({ description: 'Optional client id' }),
            name: noteTypeName,
            fields: fieldsInput,
            templates: templatesInput,
            css: css.optional(),
            kind: NoteTypeKindSchema.default('standard').optional(),
            options: NoteTypeOptionsSchema.optional(),
          }),
        },
      },
    },
  },
  responses: {
    201: { description: 'Created', content: { 'application/json': { schema: NoteTypeSchema } } },
    409: problemResponse('Error'),
    422: problemResponse('Error'),
  },
});

export const patchNoteTypeRoute = createRoute({
  method: 'patch',
  path: '/note-types/{noteTypeId}',
  summary: 'Edit a note type',
  description:
    'A field id kept with a new name rewrites templates. Added templates create cards for existing notes; removed templates soft-delete their cards (409 cards_would_be_removed when a reviewed card vanishes without confirmRemoval). Every card of the type is re-rendered.',
  request: {
    params: z.object({ noteTypeId }),
    body: {
      required: true,
      content: {
        'application/json': {
          schema: z
            .object({
              name: noteTypeName.optional(),
              fields: fieldsInput.optional(),
              templates: templatesInput.optional(),
              css: css.optional(),
              kind: NoteTypeKindSchema.optional(),
              options: NoteTypeOptionsSchema.optional(),
              confirmRemoval: confirmRemoval.optional(),
            })
            .refine(atLeastOne, { message: 'at least one field is required' })
            .openapi({ minProperties: 1 }),
        },
      },
    },
  },
  responses: {
    200: { description: 'Updated', content: { 'application/json': { schema: NoteTypeSchema } } },
    404: problemResponse('Error'),
    409: problemResponse('Error'),
    422: problemResponse('Error'),
  },
});

export const deleteNoteTypeRoute = createRoute({
  method: 'delete',
  path: '/note-types/{noteTypeId}',
  summary: 'Delete a note type',
  description: 'Answers 409 note_type_in_use while notes still use it.',
  request: { params: z.object({ noteTypeId }) },
  responses: {
    204: { description: 'Deleted' },
    404: problemResponse('Error'),
    409: problemResponse('Error'),
  },
});

// --- Notes ------------------------------------------------------------------------------------

export const createNoteRoute = createRoute({
  method: 'post',
  path: '/decks/{deckId}/notes',
  summary: 'Create a note and its cards',
  description:
    'One card per slot (template and ordinal) whose rendered front is not empty. Idempotent on id.',
  request: {
    params: z.object({ deckId }),
    body: {
      required: true,
      content: {
        'application/json': {
          schema: z.object({
            id: z.uuid().optional().openapi({ description: 'Optional client id' }),
            noteTypeId: z.uuid(),
            fields: fieldValues,
            tags: z.array(TagSchema).max(20).optional(),
            cardIds: z.record(z.string(), z.uuid()).optional().openapi({
              description:
                'Optional client card ids keyed by templateId for ordinal 0, and "templateId:ordinal" otherwise',
            }),
            extra: NoteExtraSchema.optional(),
          }),
        },
      },
    },
  },
  responses: {
    201: { description: 'Created', content: { 'application/json': { schema: NoteSchema } } },
    404: problemResponse('Error'),
    422: problemResponse('Error'),
  },
});

export const getNoteRoute = createRoute({
  method: 'get',
  path: '/notes/{noteId}',
  summary: 'Get a note',
  request: { params: z.object({ noteId }) },
  responses: {
    200: { description: 'Note', content: { 'application/json': { schema: NoteSchema } } },
    404: problemResponse('Error'),
  },
});

export const patchNoteRoute = createRoute({
  method: 'patch',
  path: '/notes/{noteId}',
  summary: 'Edit a note',
  description:
    'Re-renders its cards, creates cards for slots that appeared and soft-deletes cards for slots that vanished (409 cards_would_be_removed when a reviewed card vanishes without confirmRemoval).',
  request: {
    params: z.object({ noteId }),
    body: {
      required: true,
      content: {
        'application/json': {
          schema: z
            .object({
              fields: fieldValues.optional(),
              tags: z.array(TagSchema).max(20).optional(),
              deckId: z.uuid().optional(),
              extra: NoteExtraSchema.optional(),
              confirmRemoval: confirmRemoval.optional(),
            })
            .refine(atLeastOne, { message: 'at least one field is required' })
            .openapi({ minProperties: 1 }),
        },
      },
    },
  },
  responses: {
    200: { description: 'Updated', content: { 'application/json': { schema: NoteSchema } } },
    404: problemResponse('Error'),
    409: problemResponse('Error'),
    422: problemResponse('Error'),
  },
});

export const deleteNoteRoute = createRoute({
  method: 'delete',
  path: '/notes/{noteId}',
  summary: 'Delete a note with its cards, media and history',
  request: { params: z.object({ noteId }) },
  responses: { 204: { description: 'Deleted' }, 404: problemResponse('Error') },
});

export const noteRoutes = [
  listNoteTypesRoute,
  createNoteTypeRoute,
  patchNoteTypeRoute,
  deleteNoteTypeRoute,
  createNoteRoute,
  getNoteRoute,
  patchNoteRoute,
  deleteNoteRoute,
];
