import { newCard, schedule } from './index.js';
import type { FsrsState, ReplayLog, SchedulerParams } from './types.js';

/**
 * Rebuilds a card's FSRS state from its history. Order is `(reviewedAt, id)`; revoked logs are
 * skipped. This is the authority the server uses (FR-030a) and what migrations are checked against.
 */
export function replay(
  initial: FsrsState,
  logs: readonly ReplayLog[],
  params: SchedulerParams,
): FsrsState {
  const ordered = logs
    .filter((l) => l.revokedAt === null)
    .toSorted(
      (a, b) =>
        a.reviewedAt.getTime() - b.reviewedAt.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );
  let card = initial;
  for (const log of ordered) {
    if (log.kind === 'reset') {
      card = newCard(log.reviewedAt);
    } else {
      if (log.grade === null) throw new Error(`review log ${log.id} has no grade`);
      card = schedule(card, log.grade, log.reviewedAt, params).card;
    }
  }
  return card;
}
