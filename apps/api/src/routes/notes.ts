import type { OpenAPIHono } from '@hono/zod-openapi';
import {
  createNoteRoute,
  createNoteTypeRoute,
  deleteNoteRoute,
  deleteNoteTypeRoute,
  getNoteRoute,
  listNoteTypesRoute,
  patchNoteRoute,
  patchNoteTypeRoute,
} from '@anki-duo/contract';
import type { AppEnv } from '../app.js';
import {
  createNoteType,
  deleteNoteType,
  listNoteTypes,
  updateNoteType,
} from '../services/note-types.js';
import { createNote, deleteNote, getNote, updateNote } from '../services/notes.js';
import { v1 } from './v1.js';

export function registerNotes(app: OpenAPIHono<AppEnv>) {
  app.openapi(v1(listNoteTypesRoute), async (c) => {
    const { db, now } = c.get('deps');
    return c.json(await listNoteTypes(db, c.get('userId')!, now()), 200);
  });
  app.openapi(v1(createNoteTypeRoute), async (c) => {
    const { db, now } = c.get('deps');
    return c.json(await createNoteType(db, c.get('userId')!, c.req.valid('json'), now()), 201);
  });
  app.openapi(v1(patchNoteTypeRoute), async (c) => {
    const deps = c.get('deps');
    const { noteTypeId } = c.req.valid('param');
    return c.json(
      await updateNoteType(deps, c.get('userId')!, noteTypeId, c.req.valid('json'), deps.now()),
      200,
    );
  });
  app.openapi(v1(deleteNoteTypeRoute), async (c) => {
    const { db, now } = c.get('deps');
    await deleteNoteType(db, c.get('userId')!, c.req.valid('param').noteTypeId, now());
    return c.body(null, 204);
  });

  app.openapi(v1(createNoteRoute), async (c) => {
    const { db, now } = c.get('deps');
    const { deckId } = c.req.valid('param');
    return c.json(await createNote(db, c.get('userId')!, deckId, c.req.valid('json'), now()), 201);
  });
  app.openapi(v1(getNoteRoute), async (c) => {
    const { db } = c.get('deps');
    return c.json(await getNote(db, c.get('userId')!, c.req.valid('param').noteId), 200);
  });
  app.openapi(v1(patchNoteRoute), async (c) => {
    const { db, now } = c.get('deps');
    const { noteId } = c.req.valid('param');
    return c.json(await updateNote(db, c.get('userId')!, noteId, c.req.valid('json'), now()), 200);
  });
  app.openapi(v1(deleteNoteRoute), async (c) => {
    await deleteNote(c.get('deps'), c.get('userId')!, c.req.valid('param').noteId);
    return c.body(null, 204);
  });
}
