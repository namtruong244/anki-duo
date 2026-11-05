import { eq, sql } from 'drizzle-orm';
import { schema, type Db } from '../db/client.js';

/** Re-derives the card and media totals from the rows themselves, so they cannot drift. */
export async function refreshCounts(tx: Db, userId: string): Promise<{ cardCount: number }> {
  const [c] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.card)
    .where(sql`${schema.card.userId} = ${userId} and ${schema.card.deletedAt} is null`);
  const [m] = await tx
    .select({ bytes: sql<number>`coalesce(sum(${schema.mediaAsset.bytes}), 0)::float8` })
    .from(schema.mediaAsset)
    .where(sql`${schema.mediaAsset.userId} = ${userId} and ${schema.mediaAsset.deletedAt} is null`);
  const cardCount = c?.n ?? 0;
  await tx
    .update(schema.learnerStats)
    .set({ cardCount, mediaBytes: Math.round(m?.bytes ?? 0) })
    .where(eq(schema.learnerStats.userId, userId));
  return { cardCount };
}

export const CARD_LIMIT = 20_000;
export const cardCountOf = async (tx: Db, userId: string) =>
  (
    await tx
      .select({ n: schema.learnerStats.cardCount })
      .from(schema.learnerStats)
      .where(eq(schema.learnerStats.userId, userId))
  )[0]?.n ?? 0;
