/** XP per review is flat: grade never changes it, so there is nothing to game (FR-024). */
export const REVIEW_XP = 2;
export const SESSION_BONUS_XP = 5;

export function reviewXp(log: {
  kind: 'review' | 'reset';
  studyAhead: boolean;
  revokedAt: string | Date | null;
}): number {
  if (log.revokedAt || log.studyAhead || log.kind === 'reset') return 0;
  return REVIEW_XP;
}

export function sessionBonusXp(session: {
  completed: boolean;
  kind: 'node' | 'review' | 'ahead';
}): number {
  return session.completed && session.kind !== 'ahead' ? SESSION_BONUS_XP : 0;
}
