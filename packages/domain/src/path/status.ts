import type { CardState } from '../scheduler/types.js';

export interface PathCard {
  id: string;
  nodeIndex: number;
  state: CardState;
  suspended: boolean;
  position?: number;
}

export type NodeStatus = 'locked' | 'available' | 'in_progress' | 'completed';

export interface PathNode {
  index: number;
  cardIds: string[];
  cardCount: number;
  /** Cards whose state is not `new`. */
  studiedCount: number;
  /** Cards in `review` divided by the cards in the node (FR-023). */
  mastery: number;
  status: NodeStatus;
}

/**
 * A deck's learning path from its live cards (data-model: Path). Locks only steer the path view:
 * they never touch scheduling or the Review entry point (Principle I).
 */
export function pathNodes(cards: readonly PathCard[]): PathNode[] {
  const byNode = new Map<number, PathCard[]>();
  for (const c of cards) byNode.set(c.nodeIndex, [...(byNode.get(c.nodeIndex) ?? []), c]);

  const nodes: PathNode[] = [];
  let previousCompleted = true; // the first node is always open
  for (const index of [...byNode.keys()].sort((a, b) => a - b)) {
    const members = byNode.get(index)!.toSorted((a, b) => (a.position ?? 0) - (b.position ?? 0));
    const studied = members.filter((c) => c.state !== 'new').length;
    const remainingNew = members.some((c) => c.state === 'new' && !c.suspended);
    const completed = studied === members.length || !remainingNew;
    const status: NodeStatus = completed
      ? 'completed'
      : previousCompleted
        ? studied === 0
          ? 'available'
          : 'in_progress'
        : 'locked';
    nodes.push({
      index,
      cardIds: members.map((c) => c.id),
      cardCount: members.length,
      studiedCount: studied,
      mastery: members.filter((c) => c.state === 'review').length / members.length,
      status,
    });
    previousCompleted = completed;
  }
  return nodes;
}
