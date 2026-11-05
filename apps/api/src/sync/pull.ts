import { and, asc, eq, gt, sql } from 'drizzle-orm';
import type { PullResponseSchema } from '@anki-duo/contract';
import type { z } from '@hono/zod-openapi';
import { schema, type Db } from '../db/client.js';
import { toCard, toDaily, toDeck, toMedia, toStats } from '../services/mappers.js';
import { toSettings } from '../services/settings.js';

type Pull = z.infer<typeof PullResponseSchema>;

type Tagged =
  | { seq: number; kind: 'settings'; row: typeof schema.learnerSettings.$inferSelect }
  | { seq: number; kind: 'stats'; row: typeof schema.learnerStats.$inferSelect }
  | { seq: number; kind: 'deck'; row: typeof schema.deck.$inferSelect }
  | { seq: number; kind: 'card'; row: typeof schema.card.$inferSelect }
  | { seq: number; kind: 'media'; row: typeof schema.mediaAsset.$inferSelect }
  | { seq: number; kind: 'daily'; row: typeof schema.dailyActivity.$inferSelect };

/**
 * Everything the caller's rows changed after `cursor`, in `change_seq` order, capped at `limit`
 * rows across all collections. Each table is read with `limit + 1` rows, which is enough to fill
 * the page and to know whether more remain.
 */
export async function pullChanges(
  db: Db,
  userId: string,
  opts: { cursor: number; limit: number; deviceId: string; now: Date },
): Promise<Pull> {
  const { cursor, limit } = opts;
  const after = <T extends { userId: unknown; changeSeq: unknown }>(t: T) =>
    and(eq(t.userId as never, userId), gt(t.changeSeq as never, cursor));
  const first = <T>(t: { changeSeq: unknown }, table: unknown) =>
    db
      .select()
      .from(table as never)
      .where(after(t as never))
      .orderBy(asc(t.changeSeq as never))
      .limit(limit + 1) as Promise<T[]>;

  const [settings, stats, decks, cards, media, daily] = await Promise.all([
    first<typeof schema.learnerSettings.$inferSelect>(
      schema.learnerSettings,
      schema.learnerSettings,
    ),
    first<typeof schema.learnerStats.$inferSelect>(schema.learnerStats, schema.learnerStats),
    first<typeof schema.deck.$inferSelect>(schema.deck, schema.deck),
    first<typeof schema.card.$inferSelect>(schema.card, schema.card),
    first<typeof schema.mediaAsset.$inferSelect>(schema.mediaAsset, schema.mediaAsset),
    first<typeof schema.dailyActivity.$inferSelect>(schema.dailyActivity, schema.dailyActivity),
  ]);

  const all: Tagged[] = [
    ...settings.map((row) => ({ seq: row.changeSeq!, kind: 'settings' as const, row })),
    ...stats.map((row) => ({ seq: row.changeSeq!, kind: 'stats' as const, row })),
    ...decks.map((row) => ({ seq: row.changeSeq!, kind: 'deck' as const, row })),
    ...cards.map((row) => ({ seq: row.changeSeq!, kind: 'card' as const, row })),
    ...media.map((row) => ({ seq: row.changeSeq!, kind: 'media' as const, row })),
    ...daily.map((row) => ({ seq: row.changeSeq!, kind: 'daily' as const, row })),
  ].sort((a, b) => a.seq - b.seq);

  const page = all.slice(0, limit);
  const out: Pull = {
    cursor: String(page.length ? page[page.length - 1]!.seq : cursor),
    hasMore: all.length > limit,
    settings: null,
    stats: null,
    decks: [],
    cards: [],
    media: [],
    dailyActivity: [],
  };
  for (const item of page) {
    if (item.kind === 'settings') out.settings = toSettings(item.row);
    else if (item.kind === 'stats') out.stats = toStats(item.row);
    else if (item.kind === 'deck') out.decks.push(toDeck(item.row));
    else if (item.kind === 'card') out.cards.push(toCard(item.row));
    else if (item.kind === 'media') out.media.push(toMedia(item.row));
    else out.dailyActivity.push(toDaily(item.row));
  }

  // Record the device. A device id owned by another user is left alone.
  await db
    .insert(schema.device)
    .values({ id: opts.deviceId, userId, lastPullSeq: Number(out.cursor), lastSeenAt: opts.now })
    .onConflictDoUpdate({
      target: schema.device.id,
      set: { lastPullSeq: Number(out.cursor), lastSeenAt: opts.now },
      setWhere: sql`${schema.device.userId} = ${userId}`,
    });
  return out;
}
