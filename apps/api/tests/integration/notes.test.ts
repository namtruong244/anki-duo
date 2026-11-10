/* eslint-disable @typescript-eslint/no-explicit-any -- JSON bodies are untyped in these tests */
import { and, eq, isNull } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { schema } from '../../src/db/client.js';
import { createDeck, createTestDb, type TestDb } from '../helpers/db.js';
import { appAs } from '../helpers/session.js';

let t: TestDb;
let h: ReturnType<typeof appAs>;
let userId: string;
let deckId: string;
beforeEach(async () => {
  t = await createTestDb();
  h = appAs(t.db);
  userId = (await h.newUser()).id;
  deckId = (await createDeck(t.db, userId)).id;
});
afterEach(() => t.close());

const call = (path: string, method = 'GET', json?: unknown) =>
  h.call(userId, path, { method, ...(json !== undefined ? { json } : {}) });
const types = async () => ((await (await call('/note-types')).json()) as any).noteTypes as any[];
const typeNamed = async (name: string) => (await types()).find((x) => x.name === name)!;
const addNote = (noteTypeId: string, fields: Record<string, string>, extra: object = {}) =>
  call(`/decks/${deckId}/notes`, 'POST', { noteTypeId, fields, ...extra });
const liveCards = (noteId: string) =>
  t.db
    .select()
    .from(schema.card)
    .where(and(eq(schema.card.noteId, noteId), isNull(schema.card.deletedAt)));

describe('note types', () => {
  it('lazily creates the default note types once', async () => {
    const first = await types();
    expect(first.map((x) => x.name)).toEqual([
      'Basic',
      'Basic (and reversed card)',
      'Basic (optional reversed card)',
    ]);
    expect((await types()).map((x) => x.id)).toEqual(first.map((x) => x.id));
    expect(first[0].templates).toHaveLength(1);
  });

  it('creates a custom type and rejects invalid ones', async () => {
    const ok = await call('/note-types', 'POST', {
      name: 'Vocab',
      fields: [{ id: 'f_w', name: 'Word' }],
      templates: [{ id: 't_1', name: 'C1', front: '{{Word}}', back: '{{FrontSide}}' }],
      css: '.card{color:red}',
    });
    expect(ok.status).toBe(201);
    const dup = await call('/note-types', 'POST', {
      name: 'vocab',
      fields: [{ id: 'f_w', name: 'Word' }],
      templates: [{ id: 't_1', name: 'C1', front: '{{Word}}', back: '' }],
    });
    expect(dup.status).toBe(409);
    expect(((await dup.json()) as any).code).toBe('note_type_name_taken');
    const bad = await call('/note-types', 'POST', {
      name: 'Bad',
      fields: [
        { id: 'f_a', name: 'A' },
        { id: 'f_b', name: 'A' },
      ],
      templates: [{ id: 't_1', name: 'C1', front: '{{A}}', back: '' }],
    });
    expect(bad.status).toBe(422);
    expect(((await bad.json()) as any).code).toBe('invalid_note_type');
  });

  it('refuses to delete a type in use, deletes an unused one', async () => {
    const basic = await typeNamed('Basic');
    const rev = await typeNamed('Basic (and reversed card)');
    expect((await addNote(basic.id, { f_front: 'a', f_back: 'b' })).status).toBe(201);
    const res = await call(`/note-types/${basic.id}`, 'DELETE');
    expect(res.status).toBe(409);
    expect(((await res.json()) as any).code).toBe('note_type_in_use');
    expect((await call(`/note-types/${rev.id}`, 'DELETE')).status).toBe(204);
    expect((await types()).map((x) => x.id)).not.toContain(rev.id);
  });

  it('pull returns note types', async () => {
    await types();
    const res = await call(`/sync/pull?cursor=0&deviceId=${crypto.randomUUID()}`);
    const body = (await res.json()) as any;
    expect(body.noteTypes).toHaveLength(3);
  });
});

describe('notes and cards', () => {
  it('Basic note makes one html card with rendered sides', async () => {
    const basic = await typeNamed('Basic');
    const res = await addNote(basic.id, { f_front: '<b>hi</b>', f_back: 'there' }, { tags: ['x'] });
    expect(res.status).toBe(201);
    const note = (await res.json()) as any;
    expect(note.cards).toHaveLength(1);
    expect(note.tags).toEqual(['x']);
    const [card] = await liveCards(note.id);
    expect(card).toMatchObject({ format: 'html', templateId: 't_card1', noteTypeId: basic.id });
    expect(card!.front).toContain('hi');
    expect(card!.back).toContain('there');
    expect(card!.tags).toEqual(['x']);
    const got = (await (await call(`/notes/${note.id}`)).json()) as any;
    expect(got.cards).toEqual(note.cards);
  });

  it('is idempotent on id and rejects an empty front', async () => {
    const basic = await typeNamed('Basic');
    const id = crypto.randomUUID();
    await addNote(basic.id, { f_front: 'a' }, { id });
    expect((await addNote(basic.id, { f_front: 'a' }, { id })).status).toBe(201);
    expect(await t.db.select().from(schema.note)).toHaveLength(1);
    const empty = await addNote(basic.id, { f_front: '  ', f_back: 'b' });
    expect(empty.status).toBe(422);
    expect(((await empty.json()) as any).code).toBe('empty_front');
  });

  it('picks fresh ids when client-chosen note or card ids are already taken', async () => {
    const basic = await typeNamed('Basic');
    const first = (await (await addNote(basic.id, { f_front: 'a' })).json()) as any;
    const takenCard = first.cards[0].id;
    expect((await call(`/notes/${first.id}`, 'DELETE')).status).toBe(204);
    const res = await addNote(
      basic.id,
      { f_front: 'b' },
      { id: first.id, cardIds: { t_card1: takenCard } },
    );
    expect(res.status).toBe(201);
    const note = (await res.json()) as any;
    expect(note.id).not.toBe(first.id);
    expect(note.cards[0].id).not.toBe(takenCard);
  });

  it('reversed type makes two cards', async () => {
    const rev = await typeNamed('Basic (and reversed card)');
    const note = (await (await addNote(rev.id, { f_front: 'q', f_back: 'a' })).json()) as any;
    expect(note.cards.map((c: any) => c.templateId).sort()).toEqual(['t_card1', 't_card2']);
  });

  it('optional reversed card exists only when the field is filled, and a patch adds it', async () => {
    const opt = await typeNamed('Basic (optional reversed card)');
    const note = (await (await addNote(opt.id, { f_front: 'q', f_back: 'a' })).json()) as any;
    expect(note.cards).toHaveLength(1);
    const res = await call(`/notes/${note.id}`, 'PATCH', { fields: { f_addrev: 'y' } });
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).cards).toHaveLength(2);
    expect(await liveCards(note.id)).toHaveLength(2);
    const filled = (await (
      await addNote(opt.id, { f_front: 'q2', f_back: 'a2', f_addrev: 'y' })
    ).json()) as any;
    expect(filled.cards).toHaveLength(2);
  });

  it('sanitizes script and event handlers in fields', async () => {
    const basic = await typeNamed('Basic');
    const note = (await (
      await addNote(basic.id, {
        f_front: '<img src="https://x/y.png" onerror="alert(1)"><script>alert(2)</script>ok',
      })
    ).json()) as any;
    const [card] = await liveCards(note.id);
    expect(card!.front).not.toMatch(/script|onerror|alert/i);
    expect(card!.front).toContain('ok');
    expect(note.fields.f_front).not.toMatch(/script|onerror/i);
  });

  it('refuses front/back edits on a note card but allows tags and suspend', async () => {
    const basic = await typeNamed('Basic');
    const note = (await (await addNote(basic.id, { f_front: 'a', f_back: 'b' })).json()) as any;
    const id = note.cards[0].id;
    const res = await call(`/cards/${id}`, 'PATCH', { front: 'nope' });
    expect(res.status).toBe(409);
    expect(((await res.json()) as any).code).toBe('edit_via_note');
    expect((await call(`/cards/${id}`, 'PATCH', { tags: ['t'], suspended: true })).status).toBe(
      200,
    );
  });

  it('PATCH note re-renders cards and keeps scheduling untouched', async () => {
    const basic = await typeNamed('Basic');
    const note = (await (await addNote(basic.id, { f_front: 'a', f_back: 'b' })).json()) as any;
    await t.db
      .update(schema.card)
      .set({ reps: 5, state: 'review' })
      .where(eq(schema.card.id, note.cards[0].id));
    await call(`/notes/${note.id}`, 'PATCH', { fields: { f_back: 'changed' }, tags: ['z'] });
    const [card] = await liveCards(note.id);
    expect(card!.back).toContain('changed');
    expect(card!.tags).toEqual(['z']);
    expect(card!.reps).toBe(5);
    expect(card!.state).toBe('review');
  });

  it('deleting a note tombstones its cards; deleting its last card deletes the note', async () => {
    const rev = await typeNamed('Basic (and reversed card)');
    const note = (await (await addNote(rev.id, { f_front: 'q', f_back: 'a' })).json()) as any;
    expect((await call(`/notes/${note.id}`, 'DELETE')).status).toBe(204);
    expect(await liveCards(note.id)).toHaveLength(0);
    const rows = await t.db.select().from(schema.card).where(eq(schema.card.noteId, note.id));
    expect(rows.every((r) => r.deletedAt && r.front === '')).toBe(true);
    expect((await call(`/notes/${note.id}`)).status).toBe(404);

    const n2 = (await (await addNote(rev.id, { f_front: 'q', f_back: 'a' })).json()) as any;
    for (const c of n2.cards) await call(`/cards/${c.id}`, 'DELETE');
    expect((await call(`/notes/${n2.id}`)).status).toBe(404);
  });
});

describe('PATCH /note-types', () => {
  it('renames a field in templates and re-renders cards', async () => {
    const basic = await typeNamed('Basic');
    const note = (await (await addNote(basic.id, { f_front: 'a', f_back: 'b' })).json()) as any;
    const res = await call(`/note-types/${basic.id}`, 'PATCH', {
      fields: [
        { id: 'f_front', name: 'Question' },
        { id: 'f_back', name: 'Back' },
      ],
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.templates[0].front).toBe('{{Question}}');
    expect(body.templates[0].back).toContain('{{FrontSide}}');
    const [card] = await liveCards(note.id);
    expect(card!.front).toContain('a');
    expect(card!.front).not.toContain('tpl-error');
  });

  it('adding a template creates cards, removing one tombstones them', async () => {
    const basic = await typeNamed('Basic');
    const note = (await (await addNote(basic.id, { f_front: 'a', f_back: 'b' })).json()) as any;
    const t1 = basic.templates[0];
    const t2 = { id: 't_new', name: 'Rev', front: '{{Back}}', back: '{{FrontSide}}{{Front}}' };
    const added = await call(`/note-types/${basic.id}`, 'PATCH', { templates: [t1, t2] });
    expect(added.status).toBe(200);
    expect(await liveCards(note.id)).toHaveLength(2);
    const removed = await call(`/note-types/${basic.id}`, 'PATCH', { templates: [t2] });
    expect(removed.status).toBe(200);
    const left = await liveCards(note.id);
    expect(left.map((c) => c.templateId)).toEqual(['t_new']);
    const all = await t.db.select().from(schema.card).where(eq(schema.card.noteId, note.id));
    expect(all.filter((c) => c.deletedAt)).toHaveLength(1);
  });

  it('rejects an invalid edit and a name clash', async () => {
    const [basic, rev] = await types();
    const bad = await call(`/note-types/${basic.id}`, 'PATCH', {
      templates: [{ id: 't_x', name: 'X', front: '{{Nope}}', back: '' }],
    });
    expect(bad.status).toBe(422);
    const clash = await call(`/note-types/${basic.id}`, 'PATCH', { name: rev.name.toUpperCase() });
    expect(clash.status).toBe(409);
  });
});

describe('export and restore', () => {
  it('round-trips note types, notes and note cards', async () => {
    const rev = await typeNamed('Basic (and reversed card)');
    await addNote(rev.id, { f_front: '<i>q</i>', f_back: 'a' }, { tags: ['k'] });
    const res = await call(`/decks/${deckId}/export`);
    const doc = (await res.json()) as any;
    expect(doc.noteTypes).toHaveLength(1);
    expect(doc.notes).toHaveLength(1);
    expect(doc.cards.every((c: any) => c.noteId === doc.notes[0].id)).toBe(true);

    const restored = await call('/decks/restore', 'POST', doc);
    expect(restored.status).toBe(201);
    const newDeck = (await restored.json()) as any;
    const notes = await t.db.select().from(schema.note).where(eq(schema.note.deckId, newDeck.id));
    expect(notes).toHaveLength(1);
    expect(notes[0]!.noteTypeId).toBe(rev.id); // same live type is reused
    const cards = await t.db.select().from(schema.card).where(eq(schema.card.deckId, newDeck.id));
    expect(cards).toHaveLength(2);
    expect(cards.every((c) => c.noteId === notes[0]!.id && c.format === 'html')).toBe(true);
  });

  it('sanitizes hostile html in a restored file', async () => {
    const basic = await typeNamed('Basic');
    await addNote(basic.id, { f_front: 'a', f_back: 'b' });
    const doc = (await (await call(`/decks/${deckId}/export`)).json()) as any;
    doc.cards[0].front = '<script>alert(1)</script>safe';
    doc.notes[0].fields.f_front = '<img src=x onerror=alert(1)>safe';
    const res = await call('/decks/restore', 'POST', doc);
    expect(res.status).toBe(201);
    const rows = await t.db.select().from(schema.card);
    expect(rows.some((r) => /<script|onerror/i.test(r.front))).toBe(false);
  });
});
