import { createContext, useContext } from 'react';
import type { Answer } from '@anki-duo/domain';
import type { AnswerResult } from '../../client/session/session-machine';
import type { StoredAnswer } from '../../client/local-store';

/**
 * What slot widgets (TypeInSlot, ChoiceSlot, OcclusionView, TtsSlot) can read and call. The
 * session page wraps the card in `AnswerContext.Provider`; React context passes through the
 * portals CardHtml uses to mount widgets inside its shadow root, so widgets just call
 * `useAnswer()`.
 *
 * - `status`: where the card is (`front`: plain reveal, `answering`: waiting for the learner's
 *   answer, `back`: feedback shown).
 * - `answer`: the effective answer to check against (null when the card has none).
 * - `result`: the checked answer once submitted (also after a reload), else null.
 * - `suggested`: grade suggested by `result` (1|2|3), else null.
 * - `submitAnswer(result)`: reports the verdict. The session moves to the back; the widget
 *   must not grade. Confirming is the grade bar's job, and a key that submits an answer must
 *   not also confirm the suggestion (the page ignores keys originating in inputs).
 */
export interface AnswerContextValue {
  status: 'front' | 'answering' | 'back';
  answer: Answer | null;
  result: StoredAnswer | null;
  suggested: 1 | 2 | 3 | null;
  submitAnswer: (result: AnswerResult) => void;
}

const INERT: AnswerContextValue = {
  status: 'front',
  answer: null,
  result: null,
  suggested: null,
  submitAnswer: () => undefined,
};

export const AnswerContext = createContext<AnswerContextValue>(INERT);

/** The answer state of the card being shown; inert (never answerable) outside a provider. */
export function useAnswer(): AnswerContextValue {
  return useContext(AnswerContext);
}
