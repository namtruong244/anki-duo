import type { NoteExtra, NoteTypeKind } from './interaction.js';
import type { NoteFields, NoteTypeDef } from './types.js';

/** Identity of one card of a note: `(templateId, ordinal)` (R2). */
export interface CardSlotRef {
  templateId: string;
  ordinal: number;
}

export type SlotLister = (
  def: NoteTypeDef,
  fields: NoteFields,
  extra: NoteExtra | null,
) => CardSlotRef[];

/** Standard and multiple_choice: one card per template, ordinal 0. */
const perTemplate: SlotLister = (def) =>
  def.templates.map((t) => ({ templateId: t.id, ordinal: 0 }));

const listers = new Map<NoteTypeKind, SlotLister>();

/**
 * Registers how a kind fans out into cards. The cloze and image-occlusion stories call this
 * from their own modules (ordinals = cloze numbers / mask numbers). Kinds without a lister,
 * and a missing `kind`, use one ordinal-0 card per template.
 */
export function registerSlotLister(kind: NoteTypeKind, lister: SlotLister): void {
  listers.set(kind, lister);
}

/** The cards a note would have, in a stable order (template order, then ordinal). Pure. */
export function listCardSlots(
  def: NoteTypeDef,
  fields: NoteFields,
  extra: NoteExtra | null,
): CardSlotRef[] {
  return (listers.get(def.kind ?? 'standard') ?? perTemplate)(def, fields, extra);
}
