import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import {
  htmlToText,
  normaliseFront,
  renderCard,
  sanitizeHtml,
  newCard,
  type NoteTypeDef,
} from '@anki-duo/domain';
import { schema, type Db } from '../db/client.js';
import type { AppDeps } from '../app.js';
import { ApiProblem } from '../problem.js';
import { deleteStorageKeys, tombstoneCardTx } from './cards.js';
import { reservePlacements } from './placement.js';
import { CARD_LIMIT, cardCountOf, refreshCounts } from './stats.js';

type NoteRow = typeof schema.note.$inferSelect;
type NoteTypeRow = typeof schema.noteType.$inferSelect;
type CardRow = typeof schema.card.$inferSelect;

export const toDef = (nt: Pick<NoteTypeRow, 'fields' | 'templates' | 'css'>): NoteTypeDef => ({
  fields: nt.fields,
  templates: nt.templates,
  css: nt.css,
});

export async function findNoteType(
  tx: Db,
  userId: string,
  noteTypeId: string,
  opts: { lock?: boolean; includeDeleted?: boolean } = {},
): Promise<NoteTypeRow> {
  const q = tx
    .select()
    .from(schema.noteType)
    .where(
      and(
        eq(schema.noteType.id, noteTypeId),
        eq(schema.noteType.userId, userId),
        opts.includeDeleted ? undefined : isNull(schema.noteType.deletedAt),
      ),
    );
  const [row] = await (opts.lock ? q.for('update') : q);
  if (!row) throw new ApiProblem(404, 'not_found', 'Note type not found');
  return row;
}

async function findNote(tx: Db, userId: string, noteId: string, lock = false): Promise<NoteRow> {
  const q = tx
    .select()
    .from(schema.note)
    .where(
      and(
        eq(schema.note.id, noteId),
        eq(schema.note.userId, userId),
        isNull(schema.note.deletedAt),
      ),
    );
  const [row] = await (lock ? q.for('update') : q);
  if (!row) throw new ApiProblem(404, 'not_found', 'Note not found');
  return row;
}

/** Locks live decks in id order, so concurrent writers cannot deadlock. */
export async function lockDecks(tx: Db, userId: string, deckIds: string[]) {
  const ids = [...new Set(deckIds)].sort();
  if (!ids.length) return new Map<string, { id: string; name: string }>();
  const rows = await tx
    .select({ id: schema.deck.id, name: schema.deck.name })
    .from(schema.deck)
    .where(
      and(
        inArray(schema.deck.id, ids),
        eq(schema.deck.userId, userId),
        isNull(schema.deck.deletedAt),
      ),
    )
    .orderBy(asc(schema.deck.id))
    .for('update');
  return new Map(rows.map((d) => [d.id, d]));
}

export const sanitizeFields = (def: NoteTypeDef, input: Record<string, string>) =>
  Object.fromEntries(
    def.fields
      .filter((f) => input[f.id] !== undefined)
      .map((f) => [f.id, sanitizeHtml(input[f.id]!)]),
  );

const fullFields = (def: NoteTypeDef, values: Record<string, string>) =>
  Object.fromEntries(def.fields.map((f) => [f.id, values[f.id] ?? '']));

export interface SyncCtx {
  tx: Db;
  userId: string;
  now: Date;
  /** Live cards of the learner; kept up to date locally while creating. */
  cardCount: { n: number };
  onLimit: 'throw' | 'skip';
}

export async function newSyncCtx(
  tx: Db,
  userId: string,
  now: Date,
  onLimit: SyncCtx['onLimit'],
): Promise<SyncCtx> {
  return { tx, userId, now, cardCount: { n: await cardCountOf(tx, userId) }, onLimit };
}

/**
 * Brings a note's cards in line with its note type: re-renders existing cards, creates cards for
 * templates whose front is now non-empty. A card whose front would now be empty is left as it is,
 * so its review history is never lost. Scheduling columns are never touched. The caller holds
 * the lock on the deck row.
 */
export async function syncNoteCards(
  ctx: SyncCtx,
  note: Pick<NoteRow, 'id' | 'deckId' | 'noteTypeId' | 'fields' | 'tags'>,
  nt: Pick<NoteTypeRow, 'fields' | 'templates' | 'css'>,
  deckName: string,
  cardIds: Record<string, string> = {},
): Promise<CardRow[]> {
  const { tx, userId, now } = ctx;
  const def = toDef(nt);
  const fields = fullFields(def, note.fields);
  const live = await tx
    .select()
    .from(schema.card)
    .where(and(eq(schema.card.noteId, note.id), isNull(schema.card.deletedAt)));
  const byTemplate = new Map(live.map((c) => [c.templateId, c]));
  const firstText = htmlToText(fields[def.fields[0]?.id ?? ''] ?? '');
  const out: CardRow[] = [];

  for (const tpl of def.templates) {
    const r = renderCard(def, tpl, fields, { tags: note.tags, deckName });
    const frontNorm = normaliseFront(firstText || htmlToText(r.front));
    const existing = byTemplate.get(tpl.id);
    if (existing) {
      const same =
        existing.front === r.front &&
        existing.back === r.back &&
        existing.format === 'html' &&
        existing.deckId === note.deckId &&
        existing.noteTypeId === note.noteTypeId &&
        existing.tags.join('\n') === note.tags.join('\n');
      if (r.frontEmpty || same) {
        out.push(existing);
        continue;
      }
      const [row] = await tx
        .update(schema.card)
        .set({
          front: r.front,
          back: r.back,
          frontNorm,
          tags: note.tags,
          format: 'html',
          noteTypeId: note.noteTypeId,
          updatedAt: now,
        })
        .where(eq(schema.card.id, existing.id))
        .returning();
      out.push(row!);
      continue;
    }
    if (r.frontEmpty) continue;
    if (ctx.cardCount.n >= CARD_LIMIT) {
      if (ctx.onLimit === 'skip') continue;
      throw new ApiProblem(
        422,
        'card_limit_reached',
        `A learner can have at most ${CARD_LIMIT} cards`,
      );
    }
    const [place] = await reservePlacements(tx, note.deckId, 1);
    const fresh = newCard(now);
    // A client-chosen id that is already taken (another learner's card, or a tombstone) would
    // break the insert; the server picks a fresh id instead and returns it on the note.
    let id = cardIds[tpl.id];
    if (
      id &&
      (await tx.select({ id: schema.card.id }).from(schema.card).where(eq(schema.card.id, id)))
        .length
    )
      id = undefined;
    const [row] = await tx
      .insert(schema.card)
      .values({
        id: id ?? crypto.randomUUID(),
        userId,
        deckId: note.deckId,
        position: place!.position,
        nodeIndex: place!.nodeIndex,
        front: r.front,
        back: r.back,
        frontNorm,
        noteId: note.id,
        noteTypeId: note.noteTypeId,
        templateId: tpl.id,
        format: 'html',
        tags: note.tags,
        state: fresh.state,
        due: fresh.due,
        stability: fresh.stability,
        difficulty: fresh.difficulty,
        learningSteps: fresh.learningSteps,
        reps: fresh.reps,
        lapses: fresh.lapses,
        lastReview: fresh.lastReview,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    ctx.cardCount.n++;
    out.push(row!);
  }
  return out;
}

export const toNote = (n: NoteRow, cards: Pick<CardRow, 'id' | 'templateId'>[]) => ({
  id: n.id,
  deckId: n.deckId,
  noteTypeId: n.noteTypeId,
  fields: n.fields,
  tags: n.tags,
  cards: cards.map((c) => ({ id: c.id, templateId: c.templateId! })),
  updatedAt: n.updatedAt.toISOString(),
});

async function liveCards(tx: Db, noteId: string) {
  return tx
    .select()
    .from(schema.card)
    .where(and(eq(schema.card.noteId, noteId), isNull(schema.card.deletedAt)))
    .orderBy(asc(schema.card.position));
}

export async function createNote(
  db: Db,
  userId: string,
  deckId: string,
  input: {
    id?: string | undefined;
    noteTypeId: string;
    fields: Record<string, string>;
    tags?: string[] | undefined;
    cardIds?: Record<string, string> | undefined;
  },
  now: Date,
) {
  return db.transaction(async (t) => {
    const tx = t as unknown as Db;
    const decks = await lockDecks(tx, userId, [deckId]);
    const deck = decks.get(deckId);
    if (!deck) throw new ApiProblem(404, 'not_found', 'Deck not found');

    let noteId = input.id;
    if (noteId) {
      const [existing] = await tx.select().from(schema.note).where(eq(schema.note.id, noteId));
      if (existing?.userId === userId && !existing.deletedAt)
        return toNote(existing, await liveCards(tx, existing.id)); // idempotent re-send
      if (existing) noteId = undefined; // taken by a tombstone or another learner
    }
    const nt = await findNoteType(tx, userId, input.noteTypeId);
    const def = toDef(nt);
    const fields = sanitizeFields(def, input.fields);
    const note: NoteRow = {
      id: noteId ?? crypto.randomUUID(),
      userId,
      deckId,
      noteTypeId: nt.id,
      fields: fullFields(def, fields),
      tags: input.tags ?? [],
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };
    const probe = def.templates.some(
      (tpl) =>
        !renderCard(def, tpl, note.fields, { tags: note.tags, deckName: deck.name }).frontEmpty,
    );
    if (!probe)
      throw new ApiProblem(422, 'empty_front', 'No card of this note type would have a front');

    await tx.insert(schema.note).values(note);
    const ctx = await newSyncCtx(tx, userId, now, 'throw');
    const cards = await syncNoteCards(ctx, note, nt, deck.name, input.cardIds);
    await refreshCounts(tx, userId);
    return toNote(note, cards);
  });
}

export async function getNote(db: Db, userId: string, noteId: string) {
  const note = await findNote(db, userId, noteId);
  return toNote(note, await liveCards(db, note.id));
}

export async function updateNote(
  db: Db,
  userId: string,
  noteId: string,
  patch: {
    fields?: Record<string, string> | undefined;
    tags?: string[] | undefined;
    deckId?: string | undefined;
  },
  now: Date,
) {
  return db.transaction(async (t) => {
    const tx = t as unknown as Db;
    const current = await findNote(tx, userId, noteId, true);
    const targetDeckId = patch.deckId ?? current.deckId;
    const decks = await lockDecks(tx, userId, [current.deckId, targetDeckId]);
    const deck = decks.get(targetDeckId);
    if (!deck) throw new ApiProblem(404, 'not_found', 'Deck not found');
    const nt = await findNoteType(tx, userId, current.noteTypeId, { includeDeleted: true });
    const def = toDef(nt);

    const fields = patch.fields
      ? { ...current.fields, ...sanitizeFields(def, patch.fields) }
      : current.fields;
    const tags = patch.tags ?? current.tags;
    const full = fullFields(def, fields);
    const anyFront = def.templates.some(
      (tpl) => !renderCard(def, tpl, full, { tags, deckName: deck.name }).frontEmpty,
    );
    if (!anyFront)
      throw new ApiProblem(422, 'empty_front', 'No card of this note type would have a front');

    if (targetDeckId !== current.deckId) {
      for (const c of await liveCards(tx, noteId)) {
        const [place] = await reservePlacements(tx, targetDeckId, 1);
        await tx
          .update(schema.card)
          .set({
            deckId: targetDeckId,
            position: place!.position,
            nodeIndex: place!.nodeIndex,
            updatedAt: now,
          })
          .where(eq(schema.card.id, c.id));
        await tx
          .update(schema.reviewLog)
          .set({ deckId: targetDeckId })
          .where(eq(schema.reviewLog.cardId, c.id));
      }
    }
    const [row] = await tx
      .update(schema.note)
      .set({ fields: full, tags, deckId: targetDeckId, updatedAt: now })
      .where(eq(schema.note.id, noteId))
      .returning();
    const ctx = await newSyncCtx(tx, userId, now, 'throw');
    const cards = await syncNoteCards(ctx, row!, nt, deck.name);
    await refreshCounts(tx, userId);
    return toNote(row!, cards);
  });
}

export async function deleteNote(deps: AppDeps, userId: string, noteId: string): Promise<void> {
  const { db, now } = deps;
  const keys = await db.transaction(async (t) => {
    const tx = t as unknown as Db;
    await findNote(tx, userId, noteId, true);
    const at = now();
    const keys: string[] = [];
    for (const c of await liveCards(tx, noteId))
      keys.push(...(await tombstoneCardTx(tx, c.id, at)));
    await tx
      .update(schema.note)
      .set({ fields: {}, tags: [], deletedAt: at, updatedAt: at })
      .where(eq(schema.note.id, noteId));
    await refreshCounts(tx, userId);
    return keys;
  });
  await deleteStorageKeys(deps, keys);
}
