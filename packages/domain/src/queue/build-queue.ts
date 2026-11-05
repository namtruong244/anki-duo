import type { CardState } from '../scheduler/types.js';

export interface QueueCard {
  id: string;
  state: CardState;
  due: Date;
  position: number;
  suspended: boolean;
  nodeIndex: number;
}

export interface QueueSettings {
  sessionSize: number;
  newCardsPerDay: number;
}

export interface BuildQueueInput {
  kind: 'review' | 'ahead';
  cards: readonly QueueCard[];
  now: Date;
  settings: QueueSettings;
  /** Start of the next study day: cards due at or before this instant are due today. */
  studyDayEnd: Date;
  /** New cards already introduced today in this deck. */
  introducedToday: number;
}

const byDue = (a: QueueCard, b: QueueCard) =>
  a.due.getTime() - b.due.getTime() || a.position - b.position;
const byPosition = (a: QueueCard, b: QueueCard) => a.position - b.position;
const isLearning = (c: QueueCard) => c.state === 'learning' || c.state === 'relearning';

/** Due cards in session order: learning and relearning first, then everything else by due. */
export function dueCards(cards: readonly QueueCard[], studyDayEnd: Date): QueueCard[] {
  const due = cards.filter(
    (c) => !c.suspended && c.state !== 'new' && c.due.getTime() <= studyDayEnd.getTime(),
  );
  return [...due.filter(isLearning).sort(byDue), ...due.filter((c) => !isLearning(c)).sort(byDue)];
}

/** How many new cards may still be introduced today. */
export const newCardAllowance = (settings: QueueSettings, introducedToday: number) =>
  Math.max(0, settings.newCardsPerDay - introducedToday);

/**
 * The ordered card ids of a session (FR-006, FR-015).
 *
 * - `review`: due cards first. New cards follow only when every due card fits in the session, so a
 *   new card is never introduced while a due card of the deck is left out (Principle I).
 * - `ahead`: review-state cards that are not due today, soonest first.
 */
export function buildQueue(input: BuildQueueInput): string[] {
  const { cards, settings, studyDayEnd } = input;
  if (input.kind === 'ahead') {
    return cards
      .filter(
        (c) => !c.suspended && c.state === 'review' && c.due.getTime() > studyDayEnd.getTime(),
      )
      .sort(byDue)
      .slice(0, settings.sessionSize)
      .map((c) => c.id);
  }

  const due = dueCards(cards, studyDayEnd);
  const picked = due.slice(0, settings.sessionSize);
  if (due.length > settings.sessionSize) return picked.map((c) => c.id);

  const room = Math.min(
    settings.sessionSize - picked.length,
    newCardAllowance(settings, input.introducedToday),
  );
  const fresh = cards
    .filter((c) => !c.suspended && c.state === 'new')
    .sort(byPosition)
    .slice(0, room);
  return [...picked, ...fresh].map((c) => c.id);
}

/** A card shows up again this many cards later, so a 1-minute step is not instantly repeated. */
export const REQUEUE_GAP = 3;

/**
 * Cards graded Again, or still inside their learning steps, come back in the same session when
 * their next due falls before the study day ends (Story 1 #6). Returns the new remaining queue.
 */
export function requeueAfterGrade(input: {
  remaining: readonly string[];
  cardId: string;
  stateAfter: CardState;
  nextDue: Date;
  studyDayEnd: Date;
}): string[] {
  const out = [...input.remaining];
  const again =
    (input.stateAfter === 'learning' || input.stateAfter === 'relearning') &&
    input.nextDue.getTime() <= input.studyDayEnd.getTime();
  if (again) out.splice(Math.min(REQUEUE_GAP, out.length), 0, input.cardId);
  return out;
}
