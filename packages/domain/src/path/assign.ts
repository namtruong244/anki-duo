export const NODE_SIZE = 10;

/**
 * The learning-path node a new card joins: the deck's last node while it has fewer than 10 cards,
 * otherwise the next one. An empty deck starts at node 0. A card keeps its node for life, so
 * existing nodes are never reshuffled (Story 3 #2).
 */
export function assignNodeIndex(lastNodeIndex: number | null, lastNodeCount: number): number {
  if (lastNodeIndex === null) return 0;
  return lastNodeCount < NODE_SIZE ? lastNodeIndex : lastNodeIndex + 1;
}
