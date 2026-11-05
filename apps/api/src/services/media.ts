import { randomUUID } from 'node:crypto';
import { and, eq, isNull, lt, sql } from 'drizzle-orm';
import { MAX_MEDIA_BYTES, MAX_MEDIA_BYTES_PER_LEARNER, MEDIA_MIMES } from '@anki-duo/contract';
import { schema, type Db } from '../db/client.js';
import { ApiProblem } from '../problem.js';
import type { Storage } from '../storage.js';
import { toMedia } from './mappers.js';

const UPLOAD_TTL_SEC = 15 * 60;
const PENDING_TTL_MS = 24 * 3_600_000;

export const requireStorage = (s: Storage | undefined): Storage => {
  if (!s) throw new ApiProblem(503, 'not_found', 'Media storage is not configured');
  return s;
};

const liveMedia = (userId: string, id: string) =>
  and(
    eq(schema.mediaAsset.id, id),
    eq(schema.mediaAsset.userId, userId),
    isNull(schema.mediaAsset.deletedAt),
  );

/** Pending uploads that were never confirmed are dropped, with their objects (run on upload-url). */
export async function purgePending(db: Db, storage: Storage, userId: string, now: Date) {
  const old = await db
    .select()
    .from(schema.mediaAsset)
    .where(
      and(
        eq(schema.mediaAsset.userId, userId),
        eq(schema.mediaAsset.status, 'pending'),
        lt(schema.mediaAsset.createdAt, new Date(now.getTime() - PENDING_TTL_MS)),
      ),
    );
  for (const m of old) {
    await storage.delete(m.storageKey);
    await db.delete(schema.mediaAsset).where(eq(schema.mediaAsset.id, m.id));
  }
}

export async function reserveUpload(
  db: Db,
  storage: Storage,
  userId: string,
  now: Date,
  input: { cardId: string; side: 'front' | 'back'; mime: string; bytes: number },
) {
  if (!Number.isInteger(input.bytes) || input.bytes < 1)
    throw new ApiProblem(400, 'validation_failed', 'bytes must be at least 1');
  if (!(MEDIA_MIMES as readonly string[]).includes(input.mime))
    throw new ApiProblem(415, 'unsupported_media_type');
  if (input.bytes > MAX_MEDIA_BYTES) throw new ApiProblem(413, 'media_too_large');

  const [card] = await db
    .select({ id: schema.card.id })
    .from(schema.card)
    .where(
      and(
        eq(schema.card.id, input.cardId),
        eq(schema.card.userId, userId),
        isNull(schema.card.deletedAt),
      ),
    );
  if (!card) throw new ApiProblem(404, 'not_found', 'Card not found');

  await purgePending(db, storage, userId, now);

  const [{ total }] = (await db
    .select({ total: sql<string>`coalesce(sum(${schema.mediaAsset.bytes}), 0)` })
    .from(schema.mediaAsset)
    .where(and(eq(schema.mediaAsset.userId, userId), isNull(schema.mediaAsset.deletedAt)))) as [
    { total: string },
  ];
  if (Number(total) + input.bytes > MAX_MEDIA_BYTES_PER_LEARNER)
    throw new ApiProblem(413, 'media_quota_exceeded');

  const [{ next }] = (await db
    .select({ next: sql<number>`coalesce(max(${schema.mediaAsset.sort}) + 1, 0)` })
    .from(schema.mediaAsset)
    .where(
      and(
        eq(schema.mediaAsset.cardId, card.id),
        eq(schema.mediaAsset.side, input.side),
        isNull(schema.mediaAsset.deletedAt),
      ),
    )) as [{ next: number }];

  const id = randomUUID();
  const storageKey = `u/${userId}/${id}`;
  await db.insert(schema.mediaAsset).values({
    id,
    userId,
    cardId: card.id,
    side: input.side,
    kind: input.mime.startsWith('audio/') ? 'audio' : 'image',
    mime: input.mime,
    bytes: input.bytes,
    storageKey,
    status: 'pending',
    sort: Number(next),
    createdAt: now,
  });
  return {
    mediaId: id,
    uploadUrl: await storage.presignPut(
      storageKey,
      { mime: input.mime, bytes: input.bytes },
      UPLOAD_TTL_SEC,
    ),
    expiresAt: new Date(now.getTime() + UPLOAD_TTL_SEC * 1000).toISOString(),
  };
}

export async function completeUpload(db: Db, storage: Storage, userId: string, id: string) {
  const [m] = await db.select().from(schema.mediaAsset).where(liveMedia(userId, id));
  if (!m) throw new ApiProblem(404, 'not_found');
  if (m.status === 'ready') return toMedia(m);

  const head = await storage.head(m.storageKey);
  if (!head) throw new ApiProblem(422, 'validation_failed', 'Upload not found');
  if (head.bytes !== m.bytes || head.mime !== m.mime) {
    await storage.delete(m.storageKey);
    throw new ApiProblem(422, 'validation_failed', 'Uploaded file does not match its reservation');
  }
  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(schema.mediaAsset)
      .set({ status: 'ready' })
      .where(and(eq(schema.mediaAsset.id, id), eq(schema.mediaAsset.status, 'pending')))
      .returning();
    if (row) {
      await tx
        .update(schema.learnerStats)
        .set({ mediaBytes: sql`${schema.learnerStats.mediaBytes} + ${m.bytes}` })
        .where(eq(schema.learnerStats.userId, userId));
    }
    return toMedia(row ?? { ...m, status: 'ready' });
  });
}

export async function signedMediaUrl(db: Db, storage: Storage, userId: string, id: string) {
  const [m] = await db
    .select()
    .from(schema.mediaAsset)
    .where(and(liveMedia(userId, id), eq(schema.mediaAsset.status, 'ready')));
  if (!m) throw new ApiProblem(404, 'not_found');
  return storage.presignGet(m.storageKey, 5 * 60);
}

export async function deleteMedia(db: Db, storage: Storage, userId: string, id: string, now: Date) {
  const [m] = await db.select().from(schema.mediaAsset).where(liveMedia(userId, id));
  if (!m) throw new ApiProblem(404, 'not_found');
  await storage.delete(m.storageKey);
  await db.transaction(async (tx) => {
    await tx.update(schema.mediaAsset).set({ deletedAt: now }).where(eq(schema.mediaAsset.id, id));
    if (m.status === 'ready') {
      await tx
        .update(schema.learnerStats)
        .set({ mediaBytes: sql`greatest(${schema.learnerStats.mediaBytes} - ${m.bytes}, 0)` })
        .where(eq(schema.learnerStats.userId, userId));
    }
  });
}
