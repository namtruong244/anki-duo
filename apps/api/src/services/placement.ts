import { and, eq, isNull, sql } from 'drizzle-orm';
import { assignNodeIndex } from '@anki-duo/domain';
import { schema, type Db } from '../db/client.js';

export interface Placement {
  position: number;
  nodeIndex: number;
}

/**
 * Reserves `count` consecutive cards at the end of a deck: positions from `deck.next_position`
 * (which only grows) and learning-path nodes from the deck's last node (research: Path rules).
 * The caller must hold a lock on the deck row so concurrent writers cannot interleave.
 */
export async function reservePlacements(
  tx: Db,
  deckId: string,
  count: number,
): Promise<Placement[]> {
  const [deck] = await tx
    .select({ next: schema.deck.nextPosition })
    .from(schema.deck)
    .where(eq(schema.deck.id, deckId));
  const [last] = await tx
    .select({ node: sql<number | null>`max(${schema.card.nodeIndex})` })
    .from(schema.card)
    .where(and(eq(schema.card.deckId, deckId), isNull(schema.card.deletedAt)));
  let lastNode = last?.node ?? null;
  let inLast = 0;
  if (lastNode !== null) {
    const [n] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.card)
      .where(
        and(
          eq(schema.card.deckId, deckId),
          eq(schema.card.nodeIndex, lastNode),
          isNull(schema.card.deletedAt),
        ),
      );
    inLast = n?.n ?? 0;
  }

  const out: Placement[] = [];
  let position = deck?.next ?? 0;
  for (let i = 0; i < count; i++) {
    const nodeIndex = assignNodeIndex(lastNode, inLast);
    inLast = nodeIndex === lastNode ? inLast + 1 : 1;
    lastNode = nodeIndex;
    out.push({ position: position++, nodeIndex });
  }
  await tx
    .update(schema.deck)
    .set({ nextPosition: position, updatedAt: sql`now()` })
    .where(eq(schema.deck.id, deckId));
  return out;
}
