import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import {
  htmlToText,
  normaliseFront,
  renderCard,
  sanitizeHtml,
  newCard,
  listCardSlots,
  type NoteExtra,
  type NoteTypeDef,
  type NoteTypeKind,
} from '@anki-duo/domain';
import type { z } from '@hono/zod-openapi';
import type { NoteExtraSchema } from '@anki-duo/contract';
import { schema, type Db } from '../db/client.js';
import type { AppDeps } from '../app.js';
import { ApiProblem } from '../problem.js';
import { deleteStorageKeys, tombstoneCardTx } from './cards.js';
import { reservePlacements } from './placement.js';
import { CARD_LIMIT, cardCountOf, refreshCounts } from './stats.js';

type NoteRow = typeof schema.note.$inferSelect;
type NoteTypeRow = typeof schema.noteType.$inferSelect;
type CardRow = typeof schema.card.$inferSelect;

export const toDef = (
  nt: Pick<NoteTypeRow, 'fields' | 'templates' | 'css'> &
    Partial<Pick<NoteTypeRow, 'kind' | 'options'>>,
): NoteTypeDef => ({
  fields: nt.fields,
  templates: nt.templates,
  css: nt.css,
  kind: (nt.kind ?? 'standard') as NoteTypeKind,
  options: nt.options ?? {},
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

/** 422 empty_front unless at least one card of the note would have a front. */
function assertSomeFront(
  def: NoteTypeDef,
  fields: Record<string, string>,
  extra: NoteExtra | null,
  tags: string[],
  deckName: string,
) {
  const any = listCardSlots(def, fields, extra).some(
    (slot) =>
      !renderCard(def, fields, extra, {
        templateId: slot.templateId,
        ordinal: slot.ordinal,
        tags,
        deckName,
      }).frontEmpty,
  );
  if (!any)
    throw new ApiProblem(422, 'empty_front', 'No card of this note type would have a front');
}

const fullFields = (def: NoteTypeDef, values: Record<string, string>) =>
  Object.fromEntries(def.fields.map((f) => [f.id, values[f.id] ?? '']));

/** Request-body shape of `extra` (zod output; looser than the domain type under exactOptionalPropertyTypes). */
export type NoteExtraInput = z.infer<typeof NoteExtraSchema>;

/** A card that reconciliation soft-deleted although it had been reviewed. */
export interface RemovedReviewedCard {
  id: string;
  templateId: string;
  ordinal: number;
  reps: number;
}

export interface SyncCtx {
  tx: Db;
  userId: string;
  now: Date;
  /** Live cards of the learner; kept up to date locally while creating. */
  cardCount: { n: number };
  onLimit: 'throw' | 'skip';
  /** Reviewed cards soft-deleted so far; see `assertRemovalConfirmed`. */
  removed: RemovedReviewedCard[];
  /** Notes that lost at least one card. */
  notesWithRemovals: Set<string>;
  /** Media objects of removed cards; delete them after the transaction commits. */
  storageKeys: string[];
}

export async function newSyncCtx(
  tx: Db,
  userId: string,
  now: Date,
  onLimit: SyncCtx['onLimit'],
): Promise<SyncCtx> {
  return {
    tx,
    userId,
    now,
    cardCount: { n: await cardCountOf(tx, userId) },
    onLimit,
    removed: [],
    notesWithRemovals: new Set(),
    storageKeys: [],
  };
}

/**
 * Consent gate for removals (R3). Call it after every `syncNoteCards` of one request, inside the
 * transaction: when a reviewed card was removed and the learner has not confirmed, the throw
 * rolls the whole request back, so nothing is saved.
 */
export function assertRemovalConfirmed(ctx: SyncCtx, confirmRemoval: boolean | undefined): void {
  if (!ctx.removed.length || confirmRemoval) return;
  throw new ApiProblem(409, 'cards_would_be_removed', undefined, undefined, undefined, {
    count: ctx.removed.length,
    cards: ctx.removed,
  });
}

/** A card removed by reconciliation: content is cleared, FSRS columns and review_log are kept. */
async function softDeleteCard(tx: Db, cardId: string, now: Date): Promise<string[]> {
  const media = await tx
    .select({ key: schema.mediaAsset.storageKey })
    .from(schema.mediaAsset)
    .where(eq(schema.mediaAsset.cardId, cardId));
  await tx.delete(schema.mediaAsset).where(eq(schema.mediaAsset.cardId, cardId));
  await tx
    .update(schema.card)
    .set({
      front: '',
      back: '',
      frontNorm: '',
      answerText: '',
      interaction: null,
      tags: [],
      deletedAt: now,
      updatedAt: now,
    })
    .where(eq(schema.card.id, cardId));
  return media.map((m) => m.key);
}

export const MAX_CARDS_PER_NOTE = 100;

export interface NoteContentCtx {
  tx: Db;
  userId: string;
  note: { id?: string | undefined; deckId: string; extra: NoteExtra | null };
  def: NoteTypeDef;
  fields: Record<string, string>;
  deck: { id: string; name: string };
}

/**
 * Per-kind content rules, run before cards are reconciled (create and patch of a note).
 * The stories add their rules here, each throwing a 422 ApiProblem:
 * - cloze: `cloze_required`;
 * - multiple_choice: `wrong_answers_required` (also when the note moves to a deck with
 *   mcPractice=false);
 * - image_occlusion: `occlusion_masks_required`, and mask number assignment (max `n` ever used
 *   across live and deleted cards of the note, plus 1).
 */
export async function validateNoteContent(_kind: NoteTypeKind, _c: NoteContentCtx): Promise<void> {
  // No kind has a rule yet.
}

const slotKey = (templateId: string, ordinal: number) => `${templateId}:${ordinal}`;

/**
 * Brings a note's cards in line with its note type, diffing the wanted `(templateId, ordinal)`
 * slots from `listCardSlots` against the live cards:
 * - new slots get cards, placed next to each other in ordinal order;
 * - existing slots update only content columns (front, back, front_norm, interaction,
 *   answer_text, tags), so FSRS columns are never touched;
 * - vanished slots are soft-deleted and their review_log rows kept; reviewed ones are recorded
 *   on `ctx.removed` for `assertRemovalConfirmed`;
 * - a slot whose front renders empty keeps its card (the template still exists).
 * The caller holds the lock on the deck row.
 */
export async function syncNoteCards(
  ctx: SyncCtx,
  note: Pick<NoteRow, 'id' | 'deckId' | 'noteTypeId' | 'fields' | 'tags' | 'extra'>,
  nt: Pick<NoteTypeRow, 'fields' | 'templates' | 'css'> &
    Partial<Pick<NoteTypeRow, 'kind' | 'options'>>,
  deckName: string,
  cardIds: Record<string, string> = {},
): Promise<CardRow[]> {
  const { tx, userId, now } = ctx;
  const def = toDef(nt);
  const fields = fullFields(def, note.fields);
  const extra = note.extra ?? null;
  const wanted = listCardSlots(def, fields, extra);
  if (wanted.length > MAX_CARDS_PER_NOTE)
    throw new ApiProblem(
      422,
      'too_many_cards',
      `A note can have at most ${MAX_CARDS_PER_NOTE} cards`,
    );
  const wantedKeys = new Set(wanted.map((s) => slotKey(s.templateId, s.ordinal)));
  const live = await tx
    .select()
    .from(schema.card)
    .where(and(eq(schema.card.noteId, note.id), isNull(schema.card.deletedAt)));
  const bySlot = new Map(live.map((c) => [slotKey(c.templateId ?? '', c.ordinal), c]));
  const firstText = htmlToText(fields[def.fields[0]?.id ?? ''] ?? '');

  // Vanished slots: soft-delete, remember the reviewed ones.
  const vanished = live.filter((c) => !wantedKeys.has(slotKey(c.templateId ?? '', c.ordinal)));
  if (vanished.length) {
    const reviewedLogs = new Set(
      (
        await tx
          .selectDistinct({ cardId: schema.reviewLog.cardId })
          .from(schema.reviewLog)
          .where(
            inArray(
              schema.reviewLog.cardId,
              vanished.map((c) => c.id),
            ),
          )
      ).map((r) => r.cardId),
    );
    for (const c of vanished) {
      if (c.reps > 0 || reviewedLogs.has(c.id))
        ctx.removed.push({
          id: c.id,
          templateId: c.templateId ?? '',
          ordinal: c.ordinal,
          reps: c.reps,
        });
      ctx.storageKeys.push(...(await softDeleteCard(tx, c.id, now)));
      ctx.notesWithRemovals.add(note.id);
    }
  }

  // Render every wanted slot; decide which ones need a new card.
  const rendered = wanted.map((slot) => ({
    slot,
    r: renderCard(def, fields, extra, {
      templateId: slot.templateId,
      ordinal: slot.ordinal,
      tags: note.tags,
      deckName,
    }),
  }));
  const fresh = rendered.filter((x) => !bySlot.has(slotKey(x.slot.templateId, x.slot.ordinal)));
  const creatable = fresh.filter((x) => !x.r.frontEmpty);
  let places: Awaited<ReturnType<typeof reservePlacements>> = [];
  let room = creatable.length;
  if (room) {
    const free = CARD_LIMIT - ctx.cardCount.n;
    if (room > free) {
      if (ctx.onLimit === 'throw')
        throw new ApiProblem(
          422,
          'card_limit_reached',
          `A learner can have at most ${CARD_LIMIT} cards`,
        );
      room = Math.max(0, free);
    }
    if (room) places = await reservePlacements(tx, note.deckId, room);
  }

  const out: CardRow[] = [];
  let created = 0;
  for (const { slot, r } of rendered) {
    const key = slotKey(slot.templateId, slot.ordinal);
    const frontNorm = normaliseFront(firstText || htmlToText(r.front));
    const existing = bySlot.get(key);
    if (existing) {
      const same =
        existing.front === r.front &&
        existing.back === r.back &&
        existing.format === 'html' &&
        existing.answerText === r.answerText &&
        JSON.stringify(existing.interaction ?? null) === JSON.stringify(r.interaction) &&
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
          interaction: r.interaction,
          answerText: r.answerText,
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
    if (r.frontEmpty || created >= room) continue;
    const place = places[created++]!;
    const state = newCard(now);
    // A client-chosen id that is already taken (another learner's card, or a tombstone) would
    // break the insert; the server picks a fresh id instead and returns it on the note.
    let id = cardIds[key] ?? (slot.ordinal === 0 ? cardIds[slot.templateId] : undefined);
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
        position: place.position,
        nodeIndex: place.nodeIndex,
        front: r.front,
        back: r.back,
        frontNorm,
        noteId: note.id,
        noteTypeId: note.noteTypeId,
        templateId: slot.templateId,
        ordinal: slot.ordinal,
        interaction: r.interaction,
        answerText: r.answerText,
        format: 'html',
        tags: note.tags,
        state: state.state,
        due: state.due,
        stability: state.stability,
        difficulty: state.difficulty,
        learningSteps: state.learningSteps,
        reps: state.reps,
        lapses: state.lapses,
        lastReview: state.lastReview,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    ctx.cardCount.n++;
    out.push(row!);
  }
  return out;
}

export const toNote = (n: NoteRow, cards: Pick<CardRow, 'id' | 'templateId' | 'ordinal'>[]) => ({
  id: n.id,
  deckId: n.deckId,
  noteTypeId: n.noteTypeId,
  fields: n.fields,
  tags: n.tags,
  extra: n.extra ?? null,
  cards: cards.map((c) => ({ id: c.id, templateId: c.templateId!, ordinal: c.ordinal })),
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
    extra?: NoteExtraInput | undefined;
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
      extra: (input.extra as NoteExtra | undefined) ?? null,
      tags: input.tags ?? [],
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };
    await validateNoteContent(def.kind ?? 'standard', {
      tx,
      userId,
      note,
      def,
      fields: note.fields,
      deck,
    });
    assertSomeFront(def, note.fields, note.extra, note.tags, deck.name);

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
  deps: AppDeps,
  userId: string,
  noteId: string,
  patch: {
    fields?: Record<string, string> | undefined;
    tags?: string[] | undefined;
    deckId?: string | undefined;
    extra?: NoteExtraInput | undefined;
    confirmRemoval?: boolean | undefined;
  },
  now: Date,
) {
  const { db } = deps;
  const result = await db.transaction(async (t) => {
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
    const extra = (patch.extra as NoteExtra | undefined) ?? current.extra ?? null;
    const full = fullFields(def, fields);
    await validateNoteContent(def.kind ?? 'standard', {
      tx,
      userId,
      note: { id: current.id, deckId: targetDeckId, extra },
      def,
      fields: full,
      deck,
    });
    assertSomeFront(def, full, extra, tags, deck.name);

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
      .set({ fields: full, tags, extra, deckId: targetDeckId, updatedAt: now })
      .where(eq(schema.note.id, noteId))
      .returning();
    const ctx = await newSyncCtx(tx, userId, now, 'throw');
    const cards = await syncNoteCards(ctx, row!, nt, deck.name);
    assertRemovalConfirmed(ctx, patch.confirmRemoval);
    await refreshCounts(tx, userId);
    return { note: toNote(row!, cards), keys: ctx.storageKeys };
  });
  await deleteStorageKeys(deps, result.keys);
  return result.note;
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
