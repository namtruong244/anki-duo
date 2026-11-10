import { listCardSlots, type NoteTypeDef } from '@anki-duo/domain';
import type { Note } from './content';
import { dexieStore } from './store';

/** Ids of the note's cards whose (templateId, ordinal) slot no longer exists after an edit. */
export function vanishedNoteCardIds(
  def: NoteTypeDef,
  note: Pick<Note, 'cards'>,
  fields: Record<string, string>,
  extra: Note['extra'] | null | undefined,
): string[] {
  const keep = new Set(
    listCardSlots(def, fields, extra ?? null).map((s) => `${s.templateId}:${s.ordinal}`),
  );
  return note.cards.filter((c) => !keep.has(`${c.templateId}:${c.ordinal}`)).map((c) => c.id);
}

/** Ids of local cards of a note type whose template was removed. */
export async function removedTemplateCardIds(
  noteTypeId: string,
  keptTemplateIds: string[],
): Promise<string[]> {
  const kept = new Set(keptTemplateIds);
  const ids: string[] = [];
  for (const deck of await dexieStore.listDecks()) {
    for (const c of await dexieStore.listCards(deck.id)) {
      if (c.noteTypeId === noteTypeId && c.templateId && !kept.has(c.templateId)) ids.push(c.id);
    }
  }
  return ids;
}

/** How many of these cards have been reviewed (`reps > 0` in the Dexie `cards` table). */
export async function countReviewed(cardIds: string[]): Promise<number> {
  let n = 0;
  for (const id of cardIds) if (((await dexieStore.getCard(id))?.fsrs.reps ?? 0) > 0) n++;
  return n;
}
