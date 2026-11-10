/**
 * Template filter registry (002, R1).
 *
 * A tag `{{f1:f2 arg:Field}}` is a chain of filters applied right to left to the field's HTML.
 * Each filter is a `FilterDef` registered here by name. Only `text` is built in; the interactive
 * stories (cloze, hint, type, choice, occlusion, tts, furigana, kana, kanji) call
 * `registerFilter` from their own module (`cloze.ts`, `furigana.ts`, ...). Those modules are
 * loaded through `notes/index.ts`, so registration happens when the domain barrel is imported.
 *
 * A filter is a pure function of its input. It may:
 * - return new HTML (`FilterValue.html`). The whole rendered side is sanitized afterwards, so a
 *   filter never has to sanitize, and may only emit markup the sanitizer allows;
 * - reserve an interaction slot with `ctx.addSlot(slot)`. The returned marker must be placed in
 *   the HTML; `renderCard` turns it into `<span class="ad-slot" id="ad-slot-N"></span>` after
 *   sanitization (R4), so it can never be forged from field content;
 * - set the card's checked answer (`ctx.setAnswer`) and its answer text (`ctx.setAnswerText`).
 */
import type { Answer, NoteExtra, NoteTypeKind, NoteTypeOptions, Slot } from './interaction.js';
import { escapeHtml, htmlToText } from './sanitize.js';
import type { NoteFields, NoteTypeDef } from './types.js';

export type TemplateSide = 'front' | 'back';

/** What flows through a filter chain. */
export interface FilterValue {
  /** HTML of the field (or the output of the filter to the right). Not yet sanitized. */
  html: string;
  /**
   * Plain-text answer set by an upstream filter, for a downstream one to use. For example
   * `cloze` sets the joined answers of card N so that `type` (as in `{{type:cloze:Text}}`)
   * expects them instead of the field's plain text.
   */
  expected?: string;
}

/** Per-render services handed to a filter. */
export interface FilterContext {
  side: TemplateSide;
  def: NoteTypeDef;
  kind: NoteTypeKind;
  options: NoteTypeOptions;
  /** All field values keyed by field id (raw, as stored). */
  fields: NoteFields;
  extra: NoteExtra | null;
  templateId: string;
  ordinal: number;
  /** The name of the field the chain ends in. */
  fieldName: string;
  /** Slots reserved so far on this card (front and back share one list). */
  readonly slots: readonly Slot[];
  /** Reserves a slot and returns the marker to embed in the returned HTML. */
  addSlot(slot: Slot): string;
  /** The marker of an already reserved slot (for example to show the diff on the back). */
  slotMarker(index: number): string;
  /** Sets what the answering step checks. The last call wins. */
  setAnswer(answer: Answer | null): void;
  /** Overrides the default answerText (R8). */
  setAnswerText(text: string): void;
  /** Per-render scratch space shared by all filters (for example "slot already placed"). */
  readonly state: Map<string, unknown>;
}

/**
 * Places the single interactive slot of `slot.kind` for a card (R4): the first tag on the front
 * reserves it, the first tag on the back reuses the front's slot (so the back can show the
 * feedback). Returns the marker to embed, or null when this side already has one, or when the
 * back has none to reuse and `reuseOnly` is set (a back-only tag is not interactive).
 */
export function placeSlot(ctx: FilterContext, slot: Slot, reuseOnly = false): string | null {
  const key = `slot:${slot.kind}:${ctx.side}`;
  if (ctx.state.get(key)) return null;
  const existing = ctx.slots.findIndex((s) => s.kind === slot.kind);
  if (ctx.side === 'front' && existing >= 0) return null;
  if (ctx.side === 'back' && existing < 0 && reuseOnly) return null;
  ctx.state.set(key, true);
  return existing >= 0 ? ctx.slotMarker(existing) : ctx.addSlot(slot);
}

export interface FilterDef {
  /** Lower-case name used in templates. */
  name: string;
  /** Whether the filter takes a single space-separated argument (`tts en-US`). Default 'none'. */
  arg?: 'none' | 'required';
  /**
   * Extra validation for `validateNoteType`. Return an error message (without the template
   * label) or null. `side` is the side the tag is on.
   */
  validate?(info: {
    arg: string | undefined;
    kind: NoteTypeKind;
    side: TemplateSide;
  }): string | null;
  apply(value: FilterValue, arg: string | undefined, ctx: FilterContext): FilterValue;
}

const registry = new Map<string, FilterDef>();

/** Registers (or replaces) a filter. Call at module load from a story's module. */
export function registerFilter(def: FilterDef): void {
  registry.set(def.name, def);
}

export function getFilter(name: string): FilterDef | undefined {
  return registry.get(name);
}

/** Names of all registered filters. */
export function listFilters(): string[] {
  return [...registry.keys()];
}

registerFilter({
  name: 'text',
  apply: (v) => ({ ...v, html: escapeHtml(htmlToText(v.html)) }),
});
