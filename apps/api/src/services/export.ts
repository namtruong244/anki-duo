import { createHash, randomUUID } from 'node:crypto';
import { and, asc, eq, inArray, isNull, like, sql } from 'drizzle-orm';
import {
  EXPORT_FORMAT,
  EXPORT_VERSION,
  ExportInvalidError,
  SCHEDULER_VERSION,
  TS_FSRS_VERSION,
  assignNodeIndex,
  encodeState,
  htmlToText,
  normaliseFront,
  sanitizeCss,
  sanitizeHtml,
  validateNoteType,
  exportParams,
  fsrsWeights,
  newCard,
  listCardSlots,
  parseExport,
  renderCard,
  reviewXp,
  schedule,
  toReplayLog,
  verifyExport,
  type ExportDoc,
  type FsrsState,
  type NoteExtra,
  type NoteTypeDef,
  type NoteTypeKind,
} from '@anki-duo/domain';
import { schema, type Db } from '../db/client.js';
import { ApiProblem } from '../problem.js';
import type { Storage } from '../storage.js';
import { toDeck } from './mappers.js';
import { toDef } from './notes.js';
import { getSettings } from './settings.js';

const MAX_CARDS = 20_000;
const MEDIA_URL_TTL_SEC = 7 * 24 * 3600;
const iso = (d: Date | null) => (d ? d.toISOString() : null);

export async function exportDeck(
  db: Db,
  storage: Storage | undefined,
  userId: string,
  deckId: string,
  now: Date,
) {
  const [deck] = await db
    .select()
    .from(schema.deck)
    .where(
      and(
        eq(schema.deck.id, deckId),
        eq(schema.deck.userId, userId),
        isNull(schema.deck.deletedAt),
      ),
    );
  if (!deck) throw new ApiProblem(404, 'not_found', 'Deck not found');
  const settings = await getSettings(db, userId);

  const cards = await db
    .select()
    .from(schema.card)
    .where(and(eq(schema.card.deckId, deckId), isNull(schema.card.deletedAt)))
    .orderBy(asc(schema.card.position));
  const media = await db
    .select()
    .from(schema.mediaAsset)
    .where(
      and(
        eq(schema.mediaAsset.userId, userId),
        eq(schema.mediaAsset.status, 'ready'),
        isNull(schema.mediaAsset.deletedAt),
      ),
    );
  const notes = await db
    .select()
    .from(schema.note)
    .where(and(eq(schema.note.deckId, deckId), isNull(schema.note.deletedAt)))
    .orderBy(asc(schema.note.createdAt), asc(schema.note.id));
  const typeIds = [...new Set(notes.map((n) => n.noteTypeId))];
  const noteTypes = typeIds.length
    ? await db
        .select()
        .from(schema.noteType)
        .where(and(eq(schema.noteType.userId, userId), inArray(schema.noteType.id, typeIds)))
    : [];
  const mediaByCard = new Map<string, (typeof media)[number][]>();
  for (const m of media) mediaByCard.set(m.cardId, [...(mediaByCard.get(m.cardId) ?? []), m]);
  const logs = await db
    .select()
    .from(schema.reviewLog)
    .where(eq(schema.reviewLog.deckId, deckId))
    .orderBy(asc(schema.reviewLog.reviewedAt), asc(schema.reviewLog.id));

  const doc: ExportDoc = {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: now.toISOString(),
    scheduler: {
      algorithm: 'fsrs-6',
      implementation: `ts-fsrs@${TS_FSRS_VERSION}`,
      desiredRetention: settings.desiredRetention,
      maximumIntervalDays: settings.maximumIntervalDays,
      parameters: fsrsWeights(),
    },
    deck: {
      id: deck.id,
      name: deck.name,
      newCardsPerDay: deck.newCardsPerDay,
      createdAt: deck.createdAt.toISOString(),
      mcPractice: deck.mcPractice,
    },
    noteTypes: noteTypes.map((nt) => ({
      id: nt.id,
      name: nt.name,
      fields: nt.fields,
      templates: nt.templates,
      css: nt.css,
      kind: nt.kind as NoteTypeKind,
      options: nt.options,
      builtinKey: nt.builtinKey,
    })),
    notes: notes.map((n) => ({
      id: n.id,
      noteTypeId: n.noteTypeId,
      fields: n.fields,
      tags: n.tags,
      createdAt: n.createdAt.toISOString(),
      extra: n.extra ?? null,
    })),
    cards: await Promise.all(
      cards.map(async (c) => ({
        id: c.id,
        position: c.position,
        nodeIndex: c.nodeIndex,
        front: c.front,
        back: c.back,
        tags: c.tags,
        suspended: c.suspended,
        createdAt: c.createdAt.toISOString(),
        noteId: c.noteId,
        noteTypeId: c.noteTypeId,
        templateId: c.templateId,
        ordinal: c.ordinal,
        answerText: c.answerText,
        // Informational only: restore recomputes it from the note.
        interaction: c.interaction ?? null,
        format: c.format as 'markdown' | 'html',
        fsrs: {
          state: c.state as FsrsState['state'],
          due: c.due.toISOString(),
          stability: c.stability,
          difficulty: c.difficulty,
          learningSteps: c.learningSteps,
          reps: c.reps,
          lapses: c.lapses,
          lastReview: iso(c.lastReview),
        },
        media: await Promise.all(
          (mediaByCard.get(c.id) ?? []).map(async (m) => {
            const bytes = storage ? await storage.get(m.storageKey) : null;
            return {
              id: m.id,
              side: m.side as 'front' | 'back',
              kind: m.kind as 'image' | 'audio',
              mime: m.mime,
              bytes: m.bytes,
              ...(storage
                ? { url: await storage.presignGet(m.storageKey, MEDIA_URL_TTL_SEC) }
                : {}),
              ...(bytes ? { sha256: createHash('sha256').update(bytes).digest('hex') } : {}),
            };
          }),
        ),
      })),
    ),
    reviews: logs.map((l) => ({
      id: l.id,
      cardId: l.cardId,
      kind: l.kind as 'review' | 'reset',
      grade: l.grade as 1 | 2 | 3 | 4 | null,
      reviewedAt: l.reviewedAt.toISOString(),
      durationMs: l.durationMs,
      wasNew: l.wasNew,
      wasDue: l.wasDue,
      studyAhead: l.studyAhead,
      schedulerVersion: l.schedulerVersion,
      revokedAt: iso(l.revokedAt),
      desiredRetention: Number(l.desiredRetention),
      maximumIntervalDays: l.maximumIntervalDays,
    })),
  };
  return { doc, fileName: `${deck.name.replace(/[^\p{L}\p{N}_-]+/gu, '-')}.anki-duo.json` };
}

/** Media files are not copied: references to them become plain text (alt text, or nothing). */
const stripMedia = (s: string) =>
  s.replace(/!\[([^\]]*)\]\(media:[^)]*\)/g, '$1').replace(/\[\[audio:[^\]]*\]\]/g, '');

/** Same for HTML cards: image tags and sound tokens that point at media files. */
const stripMediaHtml = (s: string) =>
  s.replace(/<img\b[^>]*\bsrc=["']?media:[^>]*>/gi, '').replace(/\[sound:[^\]]*\]/g, '');

export async function restoreDeck(db: Db, userId: string, input: unknown, now: Date) {
  let doc: ExportDoc;
  try {
    doc = parseExport(input);
    verifyExport(doc);
  } catch (e) {
    if (e instanceof ExportInvalidError) throw new ApiProblem(422, 'export_invalid', e.message);
    throw e;
  }

  // Untrusted input: note types must be well-formed before anything is written.
  for (const nt of doc.noteTypes ?? []) {
    const errors = validateNoteType({
      fields: nt.fields,
      templates: nt.templates,
      css: nt.css,
      kind: nt.kind ?? 'standard',
      options: nt.options ?? {},
    });
    if (errors.length) throw new ApiProblem(422, 'export_invalid', `note type: ${errors[0]}`);
  }

  return db.transaction(async (tx0) => {
    const tx = tx0 as unknown as Db;
    const [stats] = await tx
      .select()
      .from(schema.learnerStats)
      .where(eq(schema.learnerStats.userId, userId))
      .for('update');
    if ((stats?.cardCount ?? 0) + doc.cards.length > MAX_CARDS)
      throw new ApiProblem(422, 'card_limit_reached');

    // A free name: the original, then "(restored)", "(restored 2)", ...
    const base = doc.deck.name.slice(0, 80);
    const taken = new Set(
      (
        await tx
          .select({ name: schema.deck.name })
          .from(schema.deck)
          .where(
            and(
              eq(schema.deck.userId, userId),
              isNull(schema.deck.deletedAt),
              like(sql`lower(${schema.deck.name})`, `${base.toLowerCase().replace(/[%_]/g, '')}%`),
            ),
          )
      ).map((r) => r.name.toLowerCase()),
    );
    let name = doc.deck.name;
    for (let n = 1; taken.has(name.toLowerCase()); n++)
      name = n === 1 ? `${base} (restored)` : `${base} (restored ${n})`;

    const deckId = randomUUID();
    const [deck] = await tx
      .insert(schema.deck)
      .values({
        id: deckId,
        userId,
        name,
        newCardsPerDay: doc.deck.newCardsPerDay,
        mcPractice: doc.deck.mcPractice ?? false,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    // Note types: a live type of this learner with the same id is reused, others are re-created.
    const typeMap = new Map<string, string>();
    const typeDefs = new Map<string, NoteTypeDef>();
    const takenTypeNames = new Set(
      (
        await tx
          .select({ name: schema.noteType.name })
          .from(schema.noteType)
          .where(and(eq(schema.noteType.userId, userId), isNull(schema.noteType.deletedAt)))
      ).map((r) => r.name.toLowerCase()),
    );
    // A builtinKey is kept only while no live type of the account holds it (unique index).
    const takenKeys = new Set(
      (
        await tx
          .select({ key: schema.noteType.builtinKey })
          .from(schema.noteType)
          .where(and(eq(schema.noteType.userId, userId), isNull(schema.noteType.deletedAt)))
      )
        .map((r) => r.key)
        .filter((k): k is string => !!k),
    );
    for (const nt of doc.noteTypes ?? []) {
      const [own] = await tx
        .select()
        .from(schema.noteType)
        .where(
          and(
            eq(schema.noteType.id, nt.id),
            eq(schema.noteType.userId, userId),
            isNull(schema.noteType.deletedAt),
          ),
        );
      if (own) {
        typeMap.set(nt.id, own.id);
        typeDefs.set(own.id, toDef(own));
        continue;
      }
      const tBase = nt.name.slice(0, 80);
      let tName = nt.name.slice(0, 100);
      for (let n = 1; takenTypeNames.has(tName.toLowerCase()); n++)
        tName = n === 1 ? `${tBase} (restored)` : `${tBase} (restored ${n})`;
      takenTypeNames.add(tName.toLowerCase());
      const newId = randomUUID();
      typeMap.set(nt.id, newId);
      const builtinKey = nt.builtinKey && !takenKeys.has(nt.builtinKey) ? nt.builtinKey : null;
      if (builtinKey) takenKeys.add(builtinKey);
      const row = {
        id: newId,
        userId,
        name: tName,
        fields: nt.fields,
        templates: nt.templates,
        css: sanitizeCss(nt.css),
        kind: nt.kind ?? 'standard',
        options: nt.options ?? {},
        builtinKey,
        createdAt: now,
        updatedAt: now,
      };
      await tx.insert(schema.noteType).values(row);
      typeDefs.set(newId, toDef(row));
    }
    const noteMap = new Map<
      string,
      {
        id: string;
        typeId: string;
        fields: Record<string, string>;
        extra: NoteExtra | null;
        tags: string[];
      }
    >();
    const noteRows: (typeof schema.note.$inferInsert)[] = [];
    for (const n of doc.notes ?? []) {
      const id = randomUUID();
      const typeId = typeMap.get(n.noteTypeId)!;
      const fields = Object.fromEntries(
        Object.entries(n.fields).map(([k, v]) => [k, sanitizeHtml(stripMediaHtml(v))]),
      );
      const extra = n.extra ?? null;
      noteMap.set(n.id, { id, typeId, fields, extra, tags: n.tags.slice(0, 20) });
      noteRows.push({
        id,
        userId,
        deckId,
        noteTypeId: typeId,
        fields,
        extra,
        tags: n.tags.slice(0, 20),
        createdAt: new Date(n.createdAt),
        updatedAt: now,
      });
    }
    for (let i = 0; i < noteRows.length; i += 1000)
      await tx.insert(schema.note).values(noteRows.slice(i, i + 1000));

    // Cards get position and node from the new deck's counters, in the exported order.
    const idMap = new Map<string, string>();
    const states = new Map<string, FsrsState>();
    let position = 0;
    let lastNode: number | null = null;
    let lastCount = 0;
    const cardRows: (typeof schema.card.$inferInsert)[] = [];
    const logsByCard = new Map<string, ExportDoc['reviews']>();
    for (const r of doc.reviews) logsByCard.set(r.cardId, [...(logsByCard.get(r.cardId) ?? []), r]);
    const params = exportParams(doc);

    const logRows: (typeof schema.reviewLog.$inferInsert)[] = [];
    // Note cards are re-rendered here, never copied from the file: front, back, interaction and
    // answerText come from the note (R13). A file card is matched to its slot by
    // (noteId, templateId, ordinal); one whose slot no longer exists is skipped.
    const slotCards = new Map<string, ReturnType<typeof renderCard>>();
    const slotOrder: { noteKey: string; templateId: string; ordinal: number }[] = [];
    for (const [fileNoteId, note] of noteMap) {
      const def = typeDefs.get(note.typeId)!;
      const full = Object.fromEntries(def.fields.map((f) => [f.id, note.fields[f.id] ?? '']));
      for (const slot of listCardSlots(def, full, note.extra)) {
        slotCards.set(
          `${fileNoteId}\n${slot.templateId}\n${slot.ordinal}`,
          renderCard(def, full, note.extra, {
            templateId: slot.templateId,
            ordinal: slot.ordinal,
            tags: note.tags,
            deckName: name,
          }),
        );
        slotOrder.push({ noteKey: fileNoteId, ...slot });
      }
    }
    const slotKeyOf = (noteKey: string, templateId: string, ordinal: number) =>
      `${noteKey}\n${templateId}\n${ordinal}`;
    const claimed = new Set<string>();
    type Item = {
      file: ExportDoc['cards'][number] | null;
      noteKey: string | null;
      tpl: string;
      ordinal: number;
    };
    const items: Item[] = [];
    for (const c of [...doc.cards].sort((a, b) => a.position - b.position)) {
      if (c.noteId && noteMap.has(c.noteId)) {
        const ordinal = c.ordinal ?? 0;
        const key = slotKeyOf(c.noteId, c.templateId ?? '', ordinal);
        if (!slotCards.has(key) || claimed.has(key)) {
          continue;
        }
        claimed.add(key);
        items.push({ file: c, noteKey: c.noteId, tpl: c.templateId ?? '', ordinal });
      } else items.push({ file: c, noteKey: null, tpl: '', ordinal: 0 });
    }
    // Slots the file has no card for (should not happen) get a new card.
    for (const o of slotOrder) {
      const key = slotKeyOf(o.noteKey, o.templateId, o.ordinal);
      if (!claimed.has(key) && !slotCards.get(key)!.frontEmpty)
        items.push({ file: null, noteKey: o.noteKey, tpl: o.templateId, ordinal: o.ordinal });
    }

    for (const item of items) {
      const c = item.file;
      const id = randomUUID();
      if (c) idMap.set(c.id, id);
      const nodeIndex = assignNodeIndex(lastNode, lastCount);
      lastCount = nodeIndex === lastNode ? lastCount + 1 : 1;
      lastNode = nodeIndex;

      // Rebuild state step by step so every log gets its own before/after snapshot.
      const created = c ? new Date(c.createdAt) : now;
      let state = newCard(created);
      const ordered = c
        ? [...(logsByCard.get(c.id) ?? [])]
            .map((r) => ({ r, l: toReplayLog(r, doc) }))
            .sort(
              (a, b) =>
                a.l.reviewedAt.getTime() - b.l.reviewedAt.getTime() || (a.l.id < b.l.id ? -1 : 1),
            )
        : [];
      for (const { r, l } of ordered) {
        const before = state;
        const after =
          l.kind === 'reset'
            ? newCard(l.reviewedAt)
            : schedule(before, l.grade!, l.reviewedAt, l.params ?? params).card;
        if (!l.revokedAt) state = after;
        logRows.push({
          id: randomUUID(),
          userId,
          cardId: id,
          deckId,
          kind: r.kind,
          grade: r.grade,
          reviewedAt: l.reviewedAt,
          durationMs: Math.min(3_600_000, Math.max(0, r.durationMs)),
          wasNew: r.wasNew,
          wasDue: r.wasDue,
          studyAhead: r.studyAhead,
          xp: reviewXp({ kind: r.kind, studyAhead: r.studyAhead, revokedAt: l.revokedAt }),
          stateBefore: encodeState(before),
          stateAfter: encodeState(after),
          schedulerVersion: r.schedulerVersion || SCHEDULER_VERSION,
          desiredRetention: (l.params ?? params).desiredRetention.toFixed(2),
          maximumIntervalDays: (l.params ?? params).maximumIntervalDays,
          revokedAt: l.revokedAt,
        });
      }
      states.set(id, state);
      const note = item.noteKey ? noteMap.get(item.noteKey) : undefined;
      const rendered = note
        ? slotCards.get(slotKeyOf(item.noteKey!, item.tpl, item.ordinal))
        : undefined;
      const html = !!note || c?.format === 'html';
      const clean = (v: string) => (html ? sanitizeHtml(stripMediaHtml(v)) : stripMedia(v));
      const front = rendered ? rendered.front : clean(c!.front) || '&nbsp;';
      const back = rendered ? rendered.back : clean(c!.back);
      let frontNorm: string;
      if (rendered && note) {
        const def = typeDefs.get(note.typeId)!;
        const firstText = htmlToText(note.fields[def.fields[0]?.id ?? ''] ?? '');
        frontNorm = normaliseFront(firstText || htmlToText(front));
      } else {
        frontNorm = html
          ? normaliseFront(htmlToText(front))
          : front.normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase();
      }
      cardRows.push({
        id,
        userId,
        deckId,
        position: position++,
        nodeIndex,
        front,
        back,
        frontNorm,
        noteId: note?.id ?? null,
        noteTypeId: note?.typeId ?? null,
        templateId: note ? item.tpl : null,
        ordinal: note ? item.ordinal : 0,
        interaction: rendered?.interaction ?? null,
        answerText: rendered?.answerText ?? '',
        format: html ? 'html' : 'markdown',
        tags: c ? c.tags : (note?.tags ?? []),
        state: state.state,
        due: state.due,
        stability: state.stability,
        difficulty: state.difficulty,
        learningSteps: state.learningSteps,
        reps: state.reps,
        lapses: state.lapses,
        lastReview: state.lastReview,
        suspended: c?.suspended ?? false,
        createdAt: created,
        updatedAt: now,
      });
    }
    if ((stats?.cardCount ?? 0) + cardRows.length > MAX_CARDS)
      throw new ApiProblem(422, 'card_limit_reached');

    for (let i = 0; i < cardRows.length; i += 1000)
      await tx.insert(schema.card).values(cardRows.slice(i, i + 1000));
    for (let i = 0; i < logRows.length; i += 1000)
      await tx.insert(schema.reviewLog).values(logRows.slice(i, i + 1000));
    await tx.update(schema.deck).set({ nextPosition: position }).where(eq(schema.deck.id, deckId));
    await tx
      .update(schema.learnerStats)
      .set({ cardCount: sql`${schema.learnerStats.cardCount} + ${cardRows.length}` })
      .where(eq(schema.learnerStats.userId, userId));
    return toDeck({ ...deck!, nextPosition: position });
  });
}
