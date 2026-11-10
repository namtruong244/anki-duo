import { useLiveQuery } from 'dexie-react-hooks';
import { dexieStore } from './store';
import type { NoteType } from './local-store';

/** Live local note type by id (undefined while loading, missing, or when `id` is empty). */
export function useNoteType(id: string | null | undefined): NoteType | undefined {
  return useLiveQuery(async () => {
    if (!id) return undefined;
    const nt = await dexieStore.getNoteType(id);
    return nt && !nt.deletedAt ? nt : undefined;
  }, [id]);
}
