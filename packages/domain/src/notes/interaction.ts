/** Interactive card types (002). Copied from specs/002-interactive-card-types/data-model.md. */

export type NoteTypeKind = 'standard' | 'cloze' | 'image_occlusion' | 'multiple_choice';

export const NOTE_TYPE_KINDS: readonly NoteTypeKind[] = [
  'standard',
  'cloze',
  'image_occlusion',
  'multiple_choice',
];

export interface NoteTypeOptions {
  /** default true */
  typeIgnoreCase?: boolean;
  /** default false */
  typeIgnoreDiacritics?: boolean;
  /** field ids; required for multiple_choice */
  roles?: { correct: string; wrong: string; explanation: string };
}

/** `n` int ≥ 1; x, y, w, h fractions of the image's natural size (0..1). */
export interface Mask {
  n: number;
  shape: 'rect' | 'ellipse';
  x: number;
  y: number;
  w: number;
  h: number;
  label?: string;
}

export type OcclusionMode = 'hide_all' | 'hide_one';

export interface NoteExtra {
  occlusion?: { mode: OcclusionMode; masks: Mask[] };
}

export type Slot =
  | { kind: 'type' }
  | { kind: 'choice' }
  | { kind: 'occlusion' }
  | { kind: 'tts'; lang: string; text: string };

export type Answer =
  | { kind: 'type'; expected: string; ignoreCase: boolean; ignoreDiacritics: boolean }
  | { kind: 'choice'; correct: string; wrong: string[]; explanationHtml: string }
  | { kind: 'occlusion'; image: string; mode: OcclusionMode; masks: Mask[]; target: number };

export interface Interaction {
  v: 1;
  /** index N ↔ <span class="ad-slot" id="ad-slot-N"> in front/back */
  slots: Slot[];
  /** what the answering step checks */
  answer: Answer | null;
}

export type Verdict = 'correct' | 'almost' | 'wrong';
