import { and, asc, eq, gt, inArray, isNull } from 'drizzle-orm';
import { renderCard, type NoteTypeDef, type NoteTypeKind } from '@anki-duo/domain';
import { schema, type Db } from './client.js';

const BATCH = 500;

/**
 * Data backfill that follows migration 0005: re-renders `answer_text` (and `interaction`) of
 * every live note card whose `answer_text` is still empty. Content columns only: scheduling
 * columns, review_log, `updated_at` and everything else stay as they are, so a rerun is safe
 * and never changes a learner's history. Rows whose note renders to an empty answer are left
 * alone (and are simply looked at again next time). Returns the number of cards updated.
 */
export async function backfill0005(db: Db): Promise<number> {
  let updated = 0;
  let after = '00000000-0000-0000-0000-000000000000';
  const decks = new Map<string, string>();
  for (;;) {
    const cards = await db
      .select({
        id: schema.card.id,
        deckId: schema.card.deckId,
        noteId: schema.card.noteId,
        templateId: schema.card.templateId,
        ordinal: schema.card.ordinal,
      })
      .from(schema.card)
      .where(
        and(
          gt(schema.card.id, after),
          isNull(schema.card.deletedAt),
          eq(schema.card.answerText, ''),
        ),
      )
      .orderBy(asc(schema.card.id))
      .limit(BATCH);
    if (!cards.length) return updated;
    after = cards[cards.length - 1]!.id;

    const noteIds = [...new Set(cards.map((c) => c.noteId).filter((x): x is string => !!x))];
    if (!noteIds.length) continue;
    const notes = new Map(
      (await db.select().from(schema.note).where(inArray(schema.note.id, noteIds))).map((n) => [
        n.id,
        n,
      ]),
    );
    const typeIds = [...new Set([...notes.values()].map((n) => n.noteTypeId))];
    const types = new Map(
      (await db.select().from(schema.noteType).where(inArray(schema.noteType.id, typeIds))).map(
        (n) => [n.id, n],
      ),
    );
    const deckIds = [...new Set(cards.map((c) => c.deckId))].filter((d) => !decks.has(d));
    if (deckIds.length)
      for (const d of await db
        .select({ id: schema.deck.id, name: schema.deck.name })
        .from(schema.deck)
        .where(inArray(schema.deck.id, deckIds)))
        decks.set(d.id, d.name);

    for (const c of cards) {
      const note = c.noteId ? notes.get(c.noteId) : undefined;
      const nt = note ? types.get(note.noteTypeId) : undefined;
      if (!note || !nt || !c.templateId) continue;
      const def: NoteTypeDef = {
        fields: nt.fields,
        templates: nt.templates,
        css: nt.css,
        kind: nt.kind as NoteTypeKind,
        options: nt.options,
      };
      let r: ReturnType<typeof renderCard>;
      try {
        const fields = Object.fromEntries(def.fields.map((f) => [f.id, note.fields[f.id] ?? '']));
        r = renderCard(def, fields, note.extra ?? null, {
          templateId: c.templateId,
          ordinal: c.ordinal,
          tags: note.tags,
          deckName: decks.get(c.deckId) ?? '',
        });
      } catch {
        continue; // a card whose template is gone: nothing to backfill
      }
      if (!r.answerText && !r.interaction) continue;
      await db
        .update(schema.card)
        .set({ answerText: r.answerText, interaction: r.interaction })
        .where(eq(schema.card.id, c.id));
      updated++;
    }
  }
}
