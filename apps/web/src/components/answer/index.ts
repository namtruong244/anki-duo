import type { ReactElement } from 'react';
import type { Slot } from '@anki-duo/domain';

/** A widget mounted into `<span class="ad-slot" id="ad-slot-N">` inside CardHtml's shadow root (R4). */
export type SlotWidget = (props: {
  slot: Slot;
  side: 'front' | 'back';
  index: number;
}) => ReactElement | null;

/** Slot kind → widget. Stories register their widgets here. */
export const slotWidgets: Partial<Record<Slot['kind'], SlotWidget>> = {};

export { AnswerContext, useAnswer, type AnswerContextValue } from './AnswerContext';
