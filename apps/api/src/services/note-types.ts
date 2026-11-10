import { and, eq, isNull, ne, notInArray, sql } from 'drizzle-orm';
import {
  DEFAULT_NOTE_TYPES,
  renameFieldInTemplates,
  sanitizeCss,
  validateNoteType,
  type NoteTypeDef,
} from '@anki-duo/domain';
import { schema, type Db } from '../db/client.js';
import type { AppDeps } from '../app.js';
import { ApiProblem } from '../problem.js';
import { deleteNoteIfOrphan, deleteStorageKeys, tombstoneCardTx } from './cards.js';
import { toNoteType } from './mappers.js';
import { findNoteType, lockDecks, newSyncCtx, syncNoteCards } from './notes.js';
import { refreshCounts } from './stats.js';

const nameTaken = () =>
  new ApiProblem(409, 'note_type_name_taken', 'A note type with this name already exists');
const isUniqueViolation = (e: unknown) =>
  /note_type_user_name_unique|duplicate key/i.test(
    String((e as Error)?.message) + String((e as { cause?: Error })?.cause?.message),
  );

async function assertNameFree(tx: Db, userId: string, name: string, exceptId?: string) {
  const clash = await tx
    .select({ id: schema.noteType.id })
    .from(schema.noteType)
    .where(
      and(
        eq(schema.noteType.userId, userId),
        isNull(schema.noteType.deletedAt),
        sql`lower(${schema.noteType.name}) = lower(${name})`,
        exceptId ? ne(schema.noteType.id, exceptId) : undefined,
      ),
    );
  if (clash.length) throw nameTaken();
}

function assertValid(def: NoteTypeDef) {
  const errors = validateNoteType(def);
  if (errors.length)
    throw new ApiProblem(
      422,
      'invalid_note_type',
      errors.join('; '),
      errors.map((message) => ({ message })),
    );
}

/** The default note types are created the first time a learner has none (live or deleted). */
export async function listNoteTypes(db: Db, userId: string, now: Date) {
  const query = () =>
    db
      .select()
      .from(schema.noteType)
      .where(and(eq(schema.noteType.userId, userId), isNull(schema.noteType.deletedAt)))
      .orderBy(schema.noteType.createdAt, schema.noteType.name);
  let rows = await query();
  if (!rows.length) {
    const [any] = await db
      .select({ id: schema.noteType.id })
      .from(schema.noteType)
      .where(eq(schema.noteType.userId, userId))
      .limit(1);
    if (!any) {
      await db
        .insert(schema.noteType)
        .values(
          DEFAULT_NOTE_TYPES.map((d, i) => ({
            id: crypto.randomUUID(),
            userId,
            name: d.name,
            fields: d.def.fields,
            templates: d.def.templates,
            css: d.def.css,
            // A stable order: createdAt is the listing order.
            createdAt: new Date(now.getTime() + i),
            updatedAt: now,
          })),
        )
        .onConflictDoNothing();
      rows = await query();
    }
  }
  return { noteTypes: rows.map(toNoteType) };
}

export async function createNoteType(
  db: Db,
  userId: string,
  input: {
    id?: string | undefined;
    name: string;
    fields: NoteTypeDef['fields'];
    templates: NoteTypeDef['templates'];
    css?: string | undefined;
  },
  now: Date,
) {
  if (input.id) {
    const [existing] = await db
      .select()
      .from(schema.noteType)
      .where(
        and(
          eq(schema.noteType.id, input.id),
          eq(schema.noteType.userId, userId),
          isNull(schema.noteType.deletedAt),
        ),
      );
    if (existing) return toNoteType(existing); // idempotent re-send
  }
  const def: NoteTypeDef = {
    fields: input.fields,
    templates: input.templates,
    css: sanitizeCss(input.css ?? ''),
  };
  assertValid(def);
  await assertNameFree(db, userId, input.name);
  try {
    const [row] = await db
      .insert(schema.noteType)
      .values({
        id: input.id ?? crypto.randomUUID(),
        userId,
        name: input.name,
        fields: def.fields,
        templates: def.templates,
        css: def.css,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    return toNoteType(row!);
  } catch (e) {
    if (isUniqueViolation(e)) throw nameTaken();
    throw e;
  }
}

export async function updateNoteType(
  deps: AppDeps,
  userId: string,
  noteTypeId: string,
  patch: {
    name?: string | undefined;
    fields?: NoteTypeDef['fields'] | undefined;
    templates?: NoteTypeDef['templates'] | undefined;
    css?: string | undefined;
  },
  now: Date,
) {
  const { db } = deps;
  const result = await db
    .transaction(async (t) => {
      const tx = t as unknown as Db;
      const nt = await findNoteType(tx, userId, noteTypeId, { lock: true });
      const fields = patch.fields ?? nt.fields;
      let templates = patch.templates ?? nt.templates;
      // A kept field id with a new name rewrites the templates that mention the old name.
      for (const f of fields) {
        const before = nt.fields.find((o) => o.id === f.id);
        if (before && before.name !== f.name)
          templates = renameFieldInTemplates(
            { fields: nt.fields, templates, css: nt.css },
            before.name,
            f.name,
          ).templates;
      }
      const def: NoteTypeDef = {
        fields,
        templates,
        css: patch.css !== undefined ? sanitizeCss(patch.css) : nt.css,
      };
      assertValid(def);
      const name = patch.name ?? nt.name;
      if (patch.name !== undefined) await assertNameFree(tx, userId, name, noteTypeId);

      const [row] = await tx
        .update(schema.noteType)
        .set({
          name,
          fields: def.fields,
          templates: def.templates,
          css: def.css,
          updatedAt: now,
        })
        .where(eq(schema.noteType.id, noteTypeId))
        .returning();

      // Removed templates: their cards are deleted like any card.
      const keys: string[] = [];
      const touched = new Set<string>();
      const templateIds = def.templates.map((x) => x.id);
      const gone = await tx
        .select({ id: schema.card.id, noteId: schema.card.noteId })
        .from(schema.card)
        .where(
          and(
            eq(schema.card.noteTypeId, noteTypeId),
            isNull(schema.card.deletedAt),
            notInArray(schema.card.templateId, templateIds),
          ),
        );
      for (const c of gone) {
        keys.push(...(await tombstoneCardTx(tx, c.id, now)));
        if (c.noteId) touched.add(c.noteId);
      }

      // Re-render every note; removed fields are dropped, added templates get cards.
      const notes = await tx
        .select()
        .from(schema.note)
        .where(and(eq(schema.note.noteTypeId, noteTypeId), isNull(schema.note.deletedAt)));
      const decks = await lockDecks(
        tx,
        userId,
        notes.map((n) => n.deckId),
      );
      const ctx = await newSyncCtx(tx, userId, now, 'skip');
      const fieldIds = new Set(def.fields.map((f) => f.id));
      for (const n of notes) {
        const deck = decks.get(n.deckId);
        if (!deck) continue;
        const kept = Object.fromEntries(
          Object.entries(n.fields).filter(([id]) => fieldIds.has(id)),
        );
        let note = n;
        if (Object.keys(kept).length !== Object.keys(n.fields).length) {
          [note] = (await tx
            .update(schema.note)
            .set({ fields: kept, updatedAt: now })
            .where(eq(schema.note.id, n.id))
            .returning()) as [typeof n];
        }
        await syncNoteCards(ctx, note, row!, deck.name);
        if (touched.has(n.id)) await deleteNoteIfOrphan(tx, n.id, now);
      }
      await refreshCounts(tx, userId);
      return { nt: toNoteType(row!), keys };
    })
    .catch((e) => {
      if (isUniqueViolation(e) && !(e instanceof ApiProblem)) throw nameTaken();
      throw e;
    });
  await deleteStorageKeys(deps, result.keys);
  return result.nt;
}

export async function deleteNoteType(db: Db, userId: string, noteTypeId: string, now: Date) {
  await db.transaction(async (t) => {
    const tx = t as unknown as Db;
    await findNoteType(tx, userId, noteTypeId, { lock: true });
    const [used] = await tx
      .select({ id: schema.note.id })
      .from(schema.note)
      .where(and(eq(schema.note.noteTypeId, noteTypeId), isNull(schema.note.deletedAt)))
      .limit(1);
    if (used) throw new ApiProblem(409, 'note_type_in_use', 'Notes still use this note type');
    await tx
      .update(schema.noteType)
      .set({ fields: [], templates: [], css: '', deletedAt: now, updatedAt: now })
      .where(eq(schema.noteType.id, noteTypeId));
  });
}
