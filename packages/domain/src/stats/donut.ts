import type { CardState } from '../scheduler/types.js';

export interface StatCard {
  id: string;
  deckId: string;
  state: CardState;
  due: Date;
  suspended: boolean;
}

export type Segment = 'suspended' | 'new' | 'learning' | 'due' | 'notDue';
export type DonutCounts = Record<Segment, number>;

/** Each card falls in exactly one segment, checked in this order (FR-028). */
export function classifyCard(card: StatCard, studyDayEnd: Date): Segment {
  if (card.suspended) return 'suspended';
  if (card.state === 'new') return 'new';
  if (card.state === 'learning' || card.state === 'relearning') return 'learning';
  return card.due.getTime() <= studyDayEnd.getTime() ? 'due' : 'notDue';
}

export function donutCounts(cards: readonly StatCard[], studyDayEnd: Date): DonutCounts {
  const counts: DonutCounts = { suspended: 0, new: 0, learning: 0, due: 0, notDue: 0 };
  for (const c of cards) counts[classifyCard(c, studyDayEnd)]++;
  return counts;
}

/** Cards to study today: Due, plus Learning due today, plus New still allowed today (per deck). */
export function todayWorkload(
  cards: readonly StatCard[],
  decks: readonly { id: string; newCardsPerDay: number; introducedToday: number }[],
  studyDayEnd: Date,
): number {
  let total = 0;
  const newByDeck = new Map<string, number>();
  for (const c of cards) {
    const seg = classifyCard(c, studyDayEnd);
    if (seg === 'due') total++;
    else if (seg === 'learning' && c.due.getTime() <= studyDayEnd.getTime()) total++;
    else if (seg === 'new') newByDeck.set(c.deckId, (newByDeck.get(c.deckId) ?? 0) + 1);
  }
  for (const d of decks) {
    total += Math.min(newByDeck.get(d.id) ?? 0, Math.max(0, d.newCardsPerDay - d.introducedToday));
  }
  return total;
}
