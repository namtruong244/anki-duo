import { and, eq, isNull } from 'drizzle-orm';
import {
  encodeState,
  newCard,
  resetCard,
  SCHEDULER_VERSION,
  normaliseFront,
} from '@anki-duo/domain';
import { schema, type Db } from '../db/client.js';
import type { AppDeps } from '../app.js';
import { ApiProblem } from '../problem.js';
import { toCard } from './mappers.js';
import { reservePlacements } from './placement.js';
import { CARD_LIMIT, cardCountOf, refreshCounts } from './stats.js';

type CardRow = typeof schema.card.$inferSelect;

export async function findCard(tx: Db, userId: string, cardId: string): Promise<CardRow> {
  const [c] = await tx
    .select()
    .from(schema.card)
    .where(
      and(
        eq(schema.card.id, cardId),
        eq(schema.card.userId, userId),
        isNull(schema.card.deletedAt),
      ),
    )
    .for('update');
  if (!c) throw new ApiProblem(404, 'not_found', 'Card not found');
  return c;
}

export async function createCard(
  db: Db,
  userId: string,
  deckId: string,
  input: {
    id?: string | undefined;
    front: string;
    back?: string | undefined;
    tags?: string[] | undefined;
  },
  now: Date,
) {
  return db.transaction(async (t) => {
    const tx = t as unknown as Db;
    // The deck row is the lock that serialises placement.
    const [deck] = await tx
      .select({ id: schema.deck.id })
      .from(schema.deck)
      .where(
        and(
          eq(schema.deck.id, deckId),
          eq(schema.deck.userId, userId),
          isNull(schema.deck.deletedAt),
        ),
      )
      .for('update');
    if (!deck) throw new ApiProblem(404, 'not_found', 'Deck not found');

    if (input.id) {
      const [existing] = await tx
        .select()
        .from(schema.card)
        .where(and(eq(schema.card.id, input.id), eq(schema.card.userId, userId)));
      if (existing && !existing.deletedAt) return toCard(existing); // idempotent re-send
    }
    if ((await cardCountOf(tx, userId)) >= CARD_LIMIT) {
      throw new ApiProblem(
        422,
        'card_limit_reached',
        `A learner can have at most ${CARD_LIMIT} cards`,
      );
    }

    const [place] = await reservePlacements(tx, deckId, 1);
    const fresh = newCard(now);
    const [row] = await tx
      .insert(schema.card)
      .values({
        id: input.id ?? crypto.randomUUID(),
        userId,
        deckId,
        position: place!.position,
        nodeIndex: place!.nodeIndex,
        front: input.front,
        back: input.back ?? '',
        frontNorm: normaliseFront(input.front),
        tags: input.tags ?? [],
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
    await refreshCounts(tx, userId);
    return toCard(row!);
  });
}

/** Content, tags and suspension only: scheduling columns are never touched here. */
export async function updateCard(
  db: Db,
  userId: string,
  cardId: string,
  patch: {
    front?: string | undefined;
    back?: string | undefined;
    tags?: string[] | undefined;
    suspended?: boolean | undefined;
  },
  now: Date,
) {
  return db.transaction(async (t) => {
    const tx = t as unknown as Db;
    const existing = await findCard(tx, userId, cardId);
    if (existing.noteId && (patch.front !== undefined || patch.back !== undefined))
      throw new ApiProblem(409, 'edit_via_note', 'Edit this card through its note');
    const [row] = await tx
      .update(schema.card)
      .set({
        ...(patch.front !== undefined
          ? { front: patch.front, frontNorm: normaliseFront(patch.front) }
          : {}),
        ...(patch.back !== undefined ? { back: patch.back } : {}),
        ...(patch.tags !== undefined ? { tags: patch.tags } : {}),
        ...(patch.suspended !== undefined ? { suspended: patch.suspended } : {}),
        updatedAt: now,
      })
      .where(eq(schema.card.id, cardId))
      .returning();
    return toCard(row!);
  });
}

/**
 * Inside a transaction: removes history and media and leaves a content-free tombstone. The caller
 * refreshes counts and deletes the returned storage keys once the transaction has committed.
 */
export async function tombstoneCardTx(tx: Db, cardId: string, now: Date): Promise<string[]> {
  const media = await tx
    .select({ key: schema.mediaAsset.storageKey })
    .from(schema.mediaAsset)
    .where(eq(schema.mediaAsset.cardId, cardId));
  await tx.delete(schema.mediaAsset).where(eq(schema.mediaAsset.cardId, cardId));
  await tx.delete(schema.reviewLog).where(eq(schema.reviewLog.cardId, cardId));
  await tx
    .update(schema.card)
    .set({ front: '', back: '', frontNorm: '', tags: [], deletedAt: now, updatedAt: now })
    .where(eq(schema.card.id, cardId));
  return media.map((m) => m.key);
}

/** Soft-deletes the note once its last live card is gone. */
export async function deleteNoteIfOrphan(tx: Db, noteId: string, now: Date): Promise<void> {
  const [left] = await tx
    .select({ id: schema.card.id })
    .from(schema.card)
    .where(and(eq(schema.card.noteId, noteId), isNull(schema.card.deletedAt)))
    .limit(1);
  if (left) return;
  await tx
    .update(schema.note)
    .set({ fields: {}, tags: [], deletedAt: now, updatedAt: now })
    .where(and(eq(schema.note.id, noteId), isNull(schema.note.deletedAt)));
}

export async function deleteStorageKeys(deps: AppDeps, keys: string[]): Promise<void> {
  for (const key of keys) await deps.storage?.delete(key).catch(() => undefined);
}

/** Deletes history and media, keeps a content-free tombstone so other devices learn of it. */
export async function deleteCard(deps: AppDeps, userId: string, cardId: string): Promise<void> {
  const { db, now } = deps;
  const keys = await db.transaction(async (t) => {
    const tx = t as unknown as Db;
    const card = await findCard(tx, userId, cardId);
    const at = now();
    const keys = await tombstoneCardTx(tx, cardId, at);
    if (card.noteId) await deleteNoteIfOrphan(tx, card.noteId, at);
    await refreshCounts(tx, userId);
    return keys;
  });
  await deleteStorageKeys(deps, keys);
}

/** FR-012: back to New. The reset is a log entry, so history stays complete and replayable. */
export async function resetCardProgress(db: Db, userId: string, cardId: string, now: Date) {
  return db.transaction(async (t) => {
    const tx = t as unknown as Db;
    const card = await findCard(tx, userId, cardId);
    const before = {
      state: card.state as 'new' | 'learning' | 'review' | 'relearning',
      due: card.due,
      stability: card.stability,
      difficulty: card.difficulty,
      learningSteps: card.learningSteps,
      reps: card.reps,
      lapses: card.lapses,
      lastReview: card.lastReview,
    };
    const after = resetCard(before, now);
    const [s] = await tx
      .select()
      .from(schema.learnerSettings)
      .where(eq(schema.learnerSettings.userId, userId));
    await tx.insert(schema.reviewLog).values({
      id: crypto.randomUUID(),
      userId,
      cardId,
      deckId: card.deckId,
      kind: 'reset',
      grade: null,
      reviewedAt: now,
      xp: 0,
      stateBefore: encodeState(before),
      stateAfter: encodeState(after),
      schedulerVersion: SCHEDULER_VERSION,
      desiredRetention: s?.desiredRetention ?? '0.90',
      maximumIntervalDays: s?.maximumIntervalDays ?? 36500,
    });
    const [row] = await tx
      .update(schema.card)
      .set({
        state: after.state,
        due: after.due,
        stability: after.stability,
        difficulty: after.difficulty,
        learningSteps: after.learningSteps,
        reps: after.reps,
        lapses: after.lapses,
        lastReview: after.lastReview,
        updatedAt: now,
      })
      .where(eq(schema.card.id, cardId))
      .returning();
    return toCard(row!);
  });
}
