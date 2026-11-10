/* eslint-disable @typescript-eslint/no-explicit-any -- JSON bodies are untyped in these tests */
import { and, eq, isNull } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_NOTE_TYPES } from '@anki-duo/domain';
import { schema } from '../../src/db/client.js';
import { createTestDb, type TestDb } from '../helpers/db.js';
import { appAs } from '../helpers/session.js';

let t: TestDb;
let h: ReturnType<typeof appAs>;
let userId: string;
beforeEach(async () => {
  t = await createTestDb();
  h = appAs(t.db);
  userId = (await h.newUser()).id;
});
afterEach(() => t.close());

const list = async () =>
  (await (await h.call(userId, '/note-types')).json()) as { noteTypes: any[] };
const rows = () =>
  t.db
    .select()
    .from(schema.noteType)
    .where(and(eq(schema.noteType.userId, userId), isNull(schema.noteType.deletedAt)));

/** A learner from before 002: only the three old built-ins (keys as the migration backfills). */
async function seedLegacy() {
  await t.db.insert(schema.noteType).values(
    DEFAULT_NOTE_TYPES.slice(0, 3).map((d, i) => ({
      id: crypto.randomUUID(),
      userId,
      name: d.name,
      fields: d.def.fields,
      templates: d.def.templates,
      css: d.def.css,
      builtinKey: d.builtinKey,
      createdAt: new Date(Date.now() + i),
    })),
  );
}

describe('built-in note type top-up (R14)', () => {
  it('a new learner gets every built-in with its key, kind and options', async () => {
    const { noteTypes } = await list();
    expect(noteTypes.map((n) => n.builtinKey).sort()).toEqual(
      DEFAULT_NOTE_TYPES.map((d) => d.builtinKey).sort(),
    );
    for (const d of DEFAULT_NOTE_TYPES) {
      const row = noteTypes.find((n) => n.builtinKey === d.builtinKey);
      expect(row).toMatchObject({ kind: d.def.kind ?? 'standard', options: d.def.options ?? {} });
    }
  });

  it('inserts each missing builtin_key for a learner who has only the old three', async () => {
    await seedLegacy();
    const first = await rows();
    const { noteTypes } = await list();
    const keys = noteTypes.map((n) => n.builtinKey);
    for (const d of DEFAULT_NOTE_TYPES) expect(keys).toContain(d.builtinKey);
    for (const r of first) expect(noteTypes.map((n) => n.id)).toContain(r.id);
    expect(noteTypes).toHaveLength(DEFAULT_NOTE_TYPES.length);
  });

  it('is idempotent, also under concurrent calls', async () => {
    await seedLegacy();
    await Promise.all(Array.from({ length: 4 }, () => list()));
    const keys = (await rows()).map((r) => r.builtinKey);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toHaveLength(DEFAULT_NOTE_TYPES.length);
    expect((await list()).noteTypes).toHaveLength(DEFAULT_NOTE_TYPES.length);
  });

  it('a renamed built-in keeps its key and is not duplicated', async () => {
    const { noteTypes } = await list();
    const basic = noteTypes.find((n) => n.builtinKey === 'basic')!;
    const res = await h.call(userId, `/note-types/${basic.id}`, {
      method: 'PATCH',
      json: { name: 'My basic' },
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).builtinKey).toBe('basic');
    const again = (await list()).noteTypes;
    expect(again).toHaveLength(DEFAULT_NOTE_TYPES.length);
    expect(again.filter((n) => n.builtinKey === 'basic')).toHaveLength(1);
    expect(again.find((n) => n.builtinKey === 'basic')!.name).toBe('My basic');
  });

  it('does not bring back a built-in the learner deleted', async () => {
    const { noteTypes } = await list();
    const rev = noteTypes.find((n) => n.builtinKey === 'basic_reversed')!;
    expect((await h.call(userId, `/note-types/${rev.id}`, { method: 'DELETE' })).status).toBe(204);
    const after = (await list()).noteTypes;
    expect(after.map((n) => n.id)).not.toContain(rev.id);
    expect(after.some((n) => n.builtinKey === 'basic_reversed')).toBe(false);
  });
});
