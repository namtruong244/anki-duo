import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { z } from '@hono/zod-openapi';
import type { ImportChunkSchema } from '@anki-duo/contract';
import { newCard, normaliseFront, validateRow } from '@anki-duo/domain';
import { schema, type Db } from '../db/client.js';
import { ApiProblem } from '../problem.js';
import { findDeck } from './decks.js';
import { reservePlacements } from './placement.js';
import { CARD_LIMIT, cardCountOf, refreshCounts } from './stats.js';

type Chunk = z.infer<typeof ImportChunkSchema>;
export interface ImportTotals {
  imported: number;
  updated: number;
  skipped: number;
  errors: { row: number; reason: string }[];
}

const totalsOf = (j: typeof schema.importJob.$inferSelect): ImportTotals => ({
  imported: j.imported,
  updated: j.updated,
  skipped: j.skipped,
  errors: j.errors as ImportTotals['errors'],
});

/** One chunk of an import (contracts/csv-import.md). Idempotent per `(jobId, chunkIndex)`. */
export async function importChunk(
  db: Db,
  userId: string,
  deckId: string,
  chunk: Chunk,
  now: Date,
): Promise<ImportTotals> {
  if (chunk.totalRows > 10_000)
    throw new ApiProblem(413, 'import_too_large', 'An import may have at most 10,000 rows');
  await findDeck(db, userId, deckId);

  return db.transaction(async (t) => {
    const tx = t as unknown as Db;
    // The deck row is the lock that keeps chunks (and other writers) from interleaving.
    await tx
      .select({ id: schema.deck.id })
      .from(schema.deck)
      .where(eq(schema.deck.id, deckId))
      .for('update');

    let [job] = await tx
      .select()
      .from(schema.importJob)
      .where(eq(schema.importJob.id, chunk.jobId));
    if (job && (job.userId !== userId || job.deckId !== deckId)) {
      throw new ApiProblem(422, 'validation_failed', 'jobId belongs to another import');
    }
    if (!job) {
      [job] = await tx
        .insert(schema.importJob)
        .values({
          id: chunk.jobId,
          userId,
          deckId,
          fileName: chunk.fileName,
          totalRows: chunk.totalRows,
          duplicateMode: chunk.duplicateMode,
          createdAt: now,
        })
        .returning();
    }
    if (chunk.chunkIndex <= job!.lastChunkIndex) return totalsOf(job!); // already applied

    const mode = job!.duplicateMode as 'skip' | 'update' | 'keep_both';
    const totals = totalsOf(job!);
    const errors = [...totals.errors];
    let { imported, updated, skipped } = totals;

    // Existing live cards of this deck by normalised front, for the keys in this chunk.
    const keys = [...new Set(chunk.rows.map((r) => normaliseFront(r.front)).filter(Boolean))];
    const byKey = new Map<string, string>();
    if (keys.length) {
      const existing = await tx
        .select({ id: schema.card.id, key: schema.card.frontNorm })
        .from(schema.card)
        .where(
          and(
            eq(schema.card.deckId, deckId),
            isNull(schema.card.deletedAt),
            inArray(schema.card.frontNorm, keys),
          ),
        );
      for (const e of existing) if (!byKey.has(e.key)) byKey.set(e.key, e.id);
    }

    let room = CARD_LIMIT - (await cardCountOf(tx, userId));
    const toCreate: {
      row: Chunk['rows'][number];
      key: string;
      front: string;
      back: string;
      tags: string[];
    }[] = [];
    const pendingByKey = new Map<string, number>(); // key -> index in toCreate, for in-file duplicates

    for (const r of chunk.rows) {
      const checked = validateRow({ front: r.front, back: r.back ?? '', tags: r.tags ?? [] });
      if (!checked.ok) {
        errors.push({ row: r.row, reason: checked.reason });
        skipped++;
        continue;
      }
      const { front, back, tags } = checked.value;
      const key = normaliseFront(front);
      const existingId = byKey.get(key);
      const pending = pendingByKey.get(key);
      const isDuplicate =
        mode !== 'keep_both' && (existingId !== undefined || pending !== undefined);

      if (isDuplicate && mode === 'skip') {
        errors.push({ row: r.row, reason: 'duplicate_skipped' });
        skipped++;
      } else if (isDuplicate) {
        // update: Back and Tags are replaced, scheduling is left alone.
        if (existingId !== undefined) {
          await tx
            .update(schema.card)
            .set({ back, tags, updatedAt: now })
            .where(eq(schema.card.id, existingId));
        } else {
          const p = toCreate[pending!]!;
          p.back = back;
          p.tags = tags;
        }
        updated++;
      } else if (room <= 0) {
        errors.push({ row: r.row, reason: 'card_limit_reached' });
        skipped++;
      } else {
        room--;
        pendingByKey.set(key, toCreate.length);
        toCreate.push({ row: r, key, front, back, tags });
        imported++;
      }
    }

    if (toCreate.length) {
      const places = await reservePlacements(tx, deckId, toCreate.length);
      const fresh = newCard(now);
      const rows = toCreate.map((c, i) => ({
        id: crypto.randomUUID(),
        userId,
        deckId,
        position: places[i]!.position,
        nodeIndex: places[i]!.nodeIndex,
        front: c.front,
        back: c.back,
        frontNorm: c.key,
        tags: c.tags,
        state: fresh.state,
        due: fresh.due,
        stability: fresh.stability,
        difficulty: fresh.difficulty,
        learningSteps: fresh.learningSteps,
        reps: fresh.reps,
        lapses: fresh.lapses,
        lastReview: fresh.lastReview,
        createdAt: now,
        updatedAt: now,
      }));
      for (let i = 0; i < rows.length; i += 500)
        await tx.insert(schema.card).values(rows.slice(i, i + 500));
      await refreshCounts(tx, userId);
    }

    await tx
      .update(schema.importJob)
      .set({
        imported,
        updated,
        skipped,
        errors,
        lastChunkIndex: chunk.chunkIndex,
        ...(chunk.isLast ? { completedAt: now } : {}),
      })
      .where(eq(schema.importJob.id, chunk.jobId));
    return { imported, updated, skipped, errors };
  });
}
