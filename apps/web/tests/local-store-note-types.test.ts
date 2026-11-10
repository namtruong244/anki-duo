import { beforeEach, describe, expect, it } from 'vitest';
import { DexieStore } from '../src/client/dexie-store';
import type { NoteType } from '../src/client/local-store';

const nt = (id: string, over: Partial<NoteType> = {}): NoteType =>
  ({
    id,
    name: `nt-${id}`,
    fields: [{ name: 'Front' }, { name: 'Back' }],
    templates: [{ name: 'Card 1', front: '{{Front}}', back: '{{FrontSide}}<hr>{{Back}}' }],
    css: '.card{}',
    updatedAt: '2026-01-01T00:00:00.000Z',
    deletedAt: null,
    ...over,
  }) as unknown as NoteType;

let store: DexieStore;
beforeEach(async () => {
  store = new DexieStore(`nt-${Math.random()}`);
  await store.open();
});

describe('LocalStore note types', () => {
  it('puts, gets and lists note types, excluding deleted', async () => {
    await store.putNoteTypes([nt('a'), nt('b', { deletedAt: '2026-01-02T00:00:00.000Z' })]);
    expect((await store.getNoteType('a'))?.name).toBe('nt-a');
    expect((await store.listNoteTypes()).map((n) => n.id)).toEqual(['a']);
  });

  it('applyPull upserts and tombstones delete', async () => {
    await store.applyPull({ noteTypes: [nt('a'), nt('b')] });
    await store.applyPull({
      noteTypes: [nt('a', { name: 'renamed' }), nt('b', { deletedAt: '2026-01-02T00:00:00.000Z' })],
    });
    expect((await store.getNoteType('a'))?.name).toBe('renamed');
    expect(await store.getNoteType('b')).toBeUndefined();
  });

  it('clearAll empties note types', async () => {
    await store.putNoteTypes([nt('a')]);
    await store.clearAll();
    expect(await store.listNoteTypes()).toEqual([]);
  });
});
