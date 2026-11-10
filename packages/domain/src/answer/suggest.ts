import type { Grade } from '../scheduler/index.js';
import type { Verdict } from '../notes/interaction.js';

/**
 * The grade suggested after an answer check (R7): wrong -> Again, almost -> Hard,
 * correct -> Good. Never Easy and never time based (FR-007, FR-009). Presentation only: the
 * scheduler sees just the grade the learner submits.
 */
export function suggestGrade(verdict: Verdict): Grade {
  switch (verdict) {
    case 'wrong':
      return 1;
    case 'almost':
      return 2;
    case 'correct':
      return 3;
  }
}
