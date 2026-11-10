/* eslint-disable @typescript-eslint/no-explicit-any -- JSON bodies are untyped in these tests */
import { and, eq, isNull } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { encodeState, newCard, registerSlotLister } from '@anki-duo/domain';
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

describe('card reconciliation (identity = note, template, ordinal)', () => {
  // One ordinal per "|"-separated part of the first field, from 1: stands in for the cloze kind
  // until its lister lands in the domain package.
  registerSlotLister('cloze', (def, fields) => {
    const parts = (fields[def.fields[0]!.id] ?? '')
      .split('|')
      .map((x) => x.trim())
      .filter(Boolean);
    return parts.flatMap((_, i) =>
      def.templates.map((tpl) => ({ templateId: tpl.id, ordinal: i + 1 })),
    );
  });

  const makeFanOutType = async (templates = 1) => {
    const id = crypto.randomUUID();
    await t.db.insert(schema.noteType).values({
      id,
      userId,
      name: `Fan ${id.slice(0, 5)}`,
      kind: 'cloze',
      fields: [{ id: 'f_text', name: 'Text' }],
      templates: Array.from({ length: templates }, (_, i) => ({
        id: `t_${i + 1}`,
        name: `C${i + 1}`,
        front: '{{Text}}',
        back: '{{FrontSide}}',
      })),
    });
    return id;
  };
  const allCards = (noteId: string) =>
    t.db.select().from(schema.card).where(eq(schema.card.noteId, noteId));
  const logReview = (cardId: string) =>
    t.db.insert(schema.reviewLog).values({
      id: crypto.randomUUID(),
      userId,
      cardId,
      deckId,
      kind: 'review',
      grade: 3,
      reviewedAt: new Date('2026-02-01T00:00:00Z'),
      stateBefore: encodeState(newCard(new Date('2026-01-01T00:00:00Z'))),
      stateAfter: encodeState(newCard(new Date('2026-01-01T00:00:00Z'))),
      schedulerVersion: 'test',
    });

  it('creates one card per slot with ordinals, adjacent positions in ordinal order', async () => {
    const typeId = await makeFanOutType();
    const res = await addNote(typeId, { f_text: 'a|b|c' });
    expect(res.status).toBe(201);
    const note = (await res.json()) as any;
    expect(note.cards.map((c: any) => [c.templateId, c.ordinal])).toEqual([
      ['t_1', 1],
      ['t_1', 2],
      ['t_1', 3],
    ]);
    const rows = (await liveCards(note.id)).sort((a, b) => a.ordinal - b.ordinal);
    expect(rows.map((r) => r.position)).toEqual([0, 1, 2]);
    expect(note.extra).toBeNull();
  });

  it('keeps existing cards (same id) when a slot is added; the new slot goes at the end', async () => {
    const typeId = await makeFanOutType();
    const note = (await (await addNote(typeId, { f_text: 'a|b' })).json()) as any;
    const before = new Map(note.cards.map((c: any) => [c.ordinal, c.id]));
    await addNote(typeId, { f_text: 'other' });
    const upd = (await (
      await call(`/notes/${note.id}`, 'PATCH', { fields: { f_text: 'a|b|c' } })
    ).json()) as any;
    expect(upd.cards).toHaveLength(3);
    for (const c of upd.cards.filter((x: any) => x.ordinal < 3))
      expect(c.id).toBe(before.get(c.ordinal));
    const added = (await allCards(note.id)).find((c) => c.ordinal === 3)!;
    expect(added.position).toBe(3);
  });

  it('honours cardIds keyed by templateId:ordinal (and bare templateId for ordinal 0)', async () => {
    const typeId = await makeFanOutType();
    const id1 = crypto.randomUUID();
    const id2 = crypto.randomUUID();
    const note = (await (
      await addNote(typeId, { f_text: 'a|b' }, { cardIds: { 't_1:1': id1, 't_1:2': id2 } })
    ).json()) as any;
    expect(note.cards.map((c: any) => c.id)).toEqual([id1, id2]);
    const basic = await typeNamed('Basic');
    const cid = crypto.randomUUID();
    const b = (await (
      await addNote(basic.id, { f_front: 'x' }, { cardIds: { t_card1: cid } })
    ).json()) as any;
    expect(b.cards[0]).toEqual({ id: cid, templateId: 't_card1', ordinal: 0 });
  });

  it('soft-deletes an unreviewed vanished slot silently', async () => {
    const typeId = await makeFanOutType();
    const note = (await (await addNote(typeId, { f_text: 'a|b|c' })).json()) as any;
    const res = await call(`/notes/${note.id}`, 'PATCH', { fields: { f_text: 'a|b' } });
    expect(res.status).toBe(200);
    expect(await liveCards(note.id)).toHaveLength(2);
    const gone = (await allCards(note.id)).filter((c) => c.deletedAt);
    expect(gone.map((c) => c.ordinal)).toEqual([3]);
  });

  it('answers 409 for a reviewed vanished card and saves nothing; confirmRemoval soft-deletes and keeps the log', async () => {
    const typeId = await makeFanOutType();
    const note = (await (await addNote(typeId, { f_text: 'a|b|c' })).json()) as any;
    const last = note.cards.find((c: any) => c.ordinal === 3);
    await t.db.update(schema.card).set({ reps: 4 }).where(eq(schema.card.id, last.id));
    await logReview(last.id);

    const res = await call(`/notes/${note.id}`, 'PATCH', { fields: { f_text: 'a' } });
    expect(res.status).toBe(409);
    const body = (await res.json()) as any;
    expect(body).toMatchObject({
      code: 'cards_would_be_removed',
      count: 1,
      cards: [{ id: last.id, templateId: 't_1', ordinal: 3, reps: 4 }],
    });
    expect(await liveCards(note.id)).toHaveLength(3);
    const [still] = await t.db.select().from(schema.note).where(eq(schema.note.id, note.id));
    expect(still!.fields.f_text).toBe('a|b|c');

    const ok = await call(`/notes/${note.id}`, 'PATCH', {
      fields: { f_text: 'a' },
      confirmRemoval: true,
    });
    expect(ok.status).toBe(200);
    expect(await liveCards(note.id)).toHaveLength(1);
    const [row] = await t.db.select().from(schema.card).where(eq(schema.card.id, last.id));
    expect(row!.deletedAt).not.toBeNull();
    expect(row!.reps).toBe(4);
    expect(
      await t.db.select().from(schema.reviewLog).where(eq(schema.reviewLog.cardId, last.id)),
    ).toHaveLength(1);
  });

  it('a card with a review_log row but reps 0 counts as reviewed', async () => {
    const typeId = await makeFanOutType();
    const note = (await (await addNote(typeId, { f_text: 'a|b' })).json()) as any;
    await logReview(note.cards.find((c: any) => c.ordinal === 2).id);
    const res = await call(`/notes/${note.id}`, 'PATCH', { fields: { f_text: 'a' } });
    expect(res.status).toBe(409);
    expect(((await res.json()) as any).cards[0]).toMatchObject({ ordinal: 2, reps: 0 });
  });

  it('PATCH note-type: 409 lists only reviewed cards and saves nothing; confirmRemoval applies', async () => {
    const typeId = await makeFanOutType(2);
    const n1 = (await (await addNote(typeId, { f_text: 'a' })).json()) as any;
    const n2 = (await (await addNote(typeId, { f_text: 'b' })).json()) as any;
    const reviewed = n1.cards.find((c: any) => c.templateId === 't_2');
    await t.db.update(schema.card).set({ reps: 2 }).where(eq(schema.card.id, reviewed.id));
    const [nt] = await t.db.select().from(schema.noteType).where(eq(schema.noteType.id, typeId));
    const keep = nt!.templates[0]!;

    const res = await call(`/note-types/${typeId}`, 'PATCH', { templates: [keep] });
    expect(res.status).toBe(409);
    const body = (await res.json()) as any;
    expect(body.code).toBe('cards_would_be_removed');
    expect(body.count).toBe(1);
    expect(body.cards).toEqual([{ id: reviewed.id, templateId: 't_2', ordinal: 1, reps: 2 }]);
    expect(await liveCards(n1.id)).toHaveLength(2);
    expect(await liveCards(n2.id)).toHaveLength(2);
    const [after] = await t.db.select().from(schema.noteType).where(eq(schema.noteType.id, typeId));
    expect(after!.templates).toHaveLength(2);

    const ok = await call(`/note-types/${typeId}`, 'PATCH', {
      templates: [keep],
      confirmRemoval: true,
    });
    expect(ok.status).toBe(200);
    expect(await liveCards(n1.id)).toHaveLength(1);
    expect(await liveCards(n2.id)).toHaveLength(1);
    const [row] = await t.db.select().from(schema.card).where(eq(schema.card.id, reviewed.id));
    expect(row!.deletedAt).not.toBeNull();
  });

  it('PATCH note-type removing a never-reviewed template needs no confirmation', async () => {
    const typeId = await makeFanOutType(2);
    const n = (await (await addNote(typeId, { f_text: 'a' })).json()) as any;
    const [nt] = await t.db.select().from(schema.noteType).where(eq(schema.noteType.id, typeId));
    const res = await call(`/note-types/${typeId}`, 'PATCH', { templates: [nt!.templates[1]!] });
    expect(res.status).toBe(200);
    expect((await liveCards(n.id)).map((c) => c.templateId)).toEqual(['t_2']);
  });

  it('keeps a slot whose front renders empty (the template still exists)', async () => {
    const rev = await typeNamed('Basic (optional reversed card)');
    const note = (await (
      await addNote(rev.id, { f_front: 'q', f_back: 'a', f_addrev: 'y' })
    ).json()) as any;
    expect(note.cards).toHaveLength(2);
    const res = await call(`/notes/${note.id}`, 'PATCH', { fields: { f_addrev: '' } });
    expect(res.status).toBe(200);
    expect(await liveCards(note.id)).toHaveLength(2);
  });

  it('rejects a note producing more than 100 cards', async () => {
    const typeId = await makeFanOutType();
    const res = await addNote(typeId, {
      f_text: Array.from({ length: 101 }, (_, i) => `c${i}`).join('|'),
    });
    expect(res.status).toBe(422);
    expect(((await res.json()) as any).code).toBe('too_many_cards');
    const ok = await addNote(typeId, {
      f_text: Array.from({ length: 100 }, (_, i) => `c${i}`).join('|'),
    });
    expect(ok.status).toBe(201);
  });

  it('never touches FSRS columns when reconciling', async () => {
    const typeId = await makeFanOutType();
    const note = (await (await addNote(typeId, { f_text: 'a|b' })).json()) as any;
    const c1 = note.cards[0].id;
    await t.db
      .update(schema.card)
      .set({ reps: 7, lapses: 2, stability: 12.5, state: 'review' })
      .where(eq(schema.card.id, c1));
    await call(`/notes/${note.id}`, 'PATCH', { fields: { f_text: 'a x|b|c' } });
    const [row] = await t.db.select().from(schema.card).where(eq(schema.card.id, c1));
    expect(row).toMatchObject({ reps: 7, lapses: 2, stability: 12.5, state: 'review' });
  });
});
