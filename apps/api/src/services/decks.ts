import { and, eq, isNull, ne, sql } from 'drizzle-orm';
import { schema, type Db } from '../db/client.js';
import type { AppDeps } from '../app.js';
import { ApiProblem } from '../problem.js';
import { toDeck } from './mappers.js';
import { refreshCounts } from './stats.js';

type DeckRow = typeof schema.deck.$inferSelect;

const nameTaken = () =>
  new ApiProblem(409, 'deck_name_taken', 'A deck with this name already exists');
const isUniqueViolation = (e: unknown) =>
  /deck_user_name_unique|duplicate key/i.test(
    String((e as Error)?.message) + String((e as { cause?: Error })?.cause?.message),
  );

export async function findDeck(db: Db, userId: string, deckId: string): Promise<DeckRow> {
  const [d] = await db
    .select()
    .from(schema.deck)
    .where(
      and(
        eq(schema.deck.id, deckId),
        eq(schema.deck.userId, userId),
        isNull(schema.deck.deletedAt),
      ),
    );
  if (!d) throw new ApiProblem(404, 'not_found', 'Deck not found');
  return d;
}

async function assertNameFree(db: Db, userId: string, name: string, exceptId?: string) {
  const clash = await db
    .select({ id: schema.deck.id })
    .from(schema.deck)
    .where(
      and(
        eq(schema.deck.userId, userId),
        isNull(schema.deck.deletedAt),
        sql`lower(${schema.deck.name}) = lower(${name})`,
        exceptId ? ne(schema.deck.id, exceptId) : undefined,
      ),
    );
  if (clash.length) throw nameTaken();
}

export async function createDeck(
  db: Db,
  userId: string,
  input: { id?: string | undefined; name: string; newCardsPerDay?: number | undefined },
  now: Date,
) {
  if (input.id) {
    const [existing] = await db
      .select()
      .from(schema.deck)
      .where(
        and(
          eq(schema.deck.id, input.id),
          eq(schema.deck.userId, userId),
          isNull(schema.deck.deletedAt),
        ),
      );
    if (existing) return toDeck(existing); // idempotent re-send of the same create
  }
  await assertNameFree(db, userId, input.name);
  try {
    const [row] = await db
      .insert(schema.deck)
      .values({
        ...(input.id ? { id: input.id } : { id: crypto.randomUUID() }),
        userId,
        name: input.name,
        newCardsPerDay: input.newCardsPerDay ?? 20,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    return toDeck(row!);
  } catch (e) {
    if (isUniqueViolation(e)) throw nameTaken();
    throw e;
  }
}

export async function updateDeck(
  db: Db,
  userId: string,
  deckId: string,
  patch: { name?: string | undefined; newCardsPerDay?: number | undefined },
  now: Date,
) {
  await findDeck(db, userId, deckId);
  if (patch.name !== undefined) await assertNameFree(db, userId, patch.name, deckId);
  try {
    const [row] = await db
      .update(schema.deck)
      .set({
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.newCardsPerDay !== undefined ? { newCardsPerDay: patch.newCardsPerDay } : {}),
        updatedAt: now,
      })
      .where(and(eq(schema.deck.id, deckId), eq(schema.deck.userId, userId)))
      .returning();
    return toDeck(row!);
  } catch (e) {
    if (isUniqueViolation(e)) throw nameTaken();
    throw e;
  }
}

/**
 * Hard-deletes the deck's cards, media and history, then keeps a tombstone row (name cleared) so
 * other devices learn the deck is gone (data-model: Deck).
 */
export async function deleteDeck(deps: AppDeps, userId: string, deckId: string): Promise<void> {
  const { db, now } = deps;
  await findDeck(db, userId, deckId);
  const keys = await db.transaction(async (t) => {
    const tx = t as unknown as Db;
    const media = await tx
      .select({ key: schema.mediaAsset.storageKey })
      .from(schema.mediaAsset)
      .innerJoin(schema.card, eq(schema.card.id, schema.mediaAsset.cardId))
      .where(eq(schema.card.deckId, deckId));
    await tx
      .delete(schema.mediaAsset)
      .where(sql`${schema.mediaAsset.cardId} in (select id from card where deck_id = ${deckId})`);
    await tx.delete(schema.reviewLog).where(eq(schema.reviewLog.deckId, deckId));
    await tx.delete(schema.studySession).where(eq(schema.studySession.deckId, deckId));
    await tx.delete(schema.importJob).where(eq(schema.importJob.deckId, deckId));
    await tx.delete(schema.card).where(eq(schema.card.deckId, deckId));
    await tx
      .update(schema.deck)
      .set({ deletedAt: now(), name: '', updatedAt: now() })
      .where(eq(schema.deck.id, deckId));
    await refreshCounts(tx, userId);
    return media.map((m) => m.key);
  });
  // Objects go after the rows are committed; a failed delete leaves an orphan, never a dangling row.
  for (const key of keys) await deps.storage?.delete(key).catch(() => undefined);
}
