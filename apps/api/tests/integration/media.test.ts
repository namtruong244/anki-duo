import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { schema } from '../../src/db/client.js';
import {
  createCard,
  createDeck,
  createTestDb,
  createUser,
  FIXED_NOW,
  type TestDb,
} from '../helpers/db.js';
import { appAs } from '../helpers/session.js';
import { fakeStorage } from '../helpers/storage.js';

let t: TestDb;
let h: ReturnType<typeof appAs>;
let fs: ReturnType<typeof fakeStorage>;
let userId: string;
let cardId: string;

beforeEach(async () => {
  t = await createTestDb();
  fs = fakeStorage();
  h = appAs(t.db, { storage: fs.storage });
  userId = (await h.newUser()).id;
  const deck = await createDeck(t.db, userId);
  cardId = (await createCard(t.db, userId, deck.id)).id;
});
afterEach(() => t.close());

const reserve = (over: Record<string, unknown> = {}, user: string | null = userId) =>
  h.call(user, '/media/upload-url', {
    method: 'POST',
    json: { cardId, side: 'front', mime: 'image/png', bytes: 1000, ...over },
  });
const keyOf = (id: string) => `u/${userId}/${id}`;
const mediaRow = async (id: string) =>
  (await t.db.select().from(schema.mediaAsset).where(eq(schema.mediaAsset.id, id)))[0];
const statsRow = async () =>
  (await t.db.select().from(schema.learnerStats).where(eq(schema.learnerStats.userId, userId)))[0]!;

async function ready(bytes = 1000, mime = 'image/png') {
  const { mediaId } = (await (await reserve({ bytes, mime })).json()) as { mediaId: string };
  fs.upload(keyOf(mediaId), new Uint8Array(bytes), mime);
  const res = await h.call(userId, `/media/${mediaId}/complete`, { method: 'POST' });
  expect(res.status).toBe(200);
  return mediaId;
}

describe('POST /media/upload-url', () => {
  it('requires a signed-in user', async () => expect((await reserve({}, null)).status).toBe(401));

  it('reserves a pending asset and returns a presigned PUT URL', async () => {
    const res = await reserve();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { mediaId: string; uploadUrl: string; expiresAt: string };
    expect(body.uploadUrl).toContain(`u/${userId}/${body.mediaId}`);
    expect(new Date(body.expiresAt).getTime()).toBeGreaterThan(FIXED_NOW.getTime());
    expect(await mediaRow(body.mediaId)).toMatchObject({
      status: 'pending',
      kind: 'image',
      side: 'front',
      bytes: 1000,
      cardId,
      userId,
    });
  });

  it.each([
    ['image/png', 'image'],
    ['image/jpeg', 'image'],
    ['image/webp', 'image'],
    ['image/gif', 'image'],
    ['image/svg+xml', 'image'],
    ['audio/mpeg', 'audio'],
    ['audio/mp4', 'audio'],
    ['audio/aac', 'audio'],
    ['audio/ogg', 'audio'],
    ['audio/wav', 'audio'],
  ])('accepts %s as %s', async (mime, kind) => {
    const body = (await (await reserve({ mime })).json()) as { mediaId: string };
    expect((await mediaRow(body.mediaId))!.kind).toBe(kind);
  });

  it('rejects other MIME types with 415 unsupported_media_type', async () => {
    const res = await reserve({ mime: 'application/pdf' });
    expect(res.status).toBe(415);
    expect(await res.json()).toMatchObject({ code: 'unsupported_media_type' });
  });

  it('accepts 5 MiB and rejects more with 413 media_too_large', async () => {
    expect((await reserve({ bytes: 5_242_880 })).status).toBe(200);
    const res = await reserve({ bytes: 5_242_881 });
    expect(res.status).toBe(413);
    expect(await res.json()).toMatchObject({ code: 'media_too_large' });
  });

  it('rejects 0 bytes and a foreign or deleted card', async () => {
    expect((await reserve({ bytes: 0 })).status).toBe(400);
    const other = await createUser(t.db);
    const od = await createDeck(t.db, other.id);
    const oc = await createCard(t.db, other.id, od.id);
    expect((await reserve({ cardId: oc.id })).status).toBe(404);
    expect((await reserve({ cardId: randomUUID() })).status).toBe(404);
  });

  it('enforces the 500 MB per learner quota with 413 media_quota_exceeded', async () => {
    await t.db.insert(schema.mediaAsset).values({
      id: randomUUID(),
      userId,
      cardId,
      side: 'back',
      kind: 'image',
      mime: 'image/png',
      bytes: 5_242_880,
      storageKey: 'x',
      status: 'ready',
    });
    // 99 more full-size files would reach 500 MiB; fake it with a direct total instead.
    await t.db
      .update(schema.mediaAsset)
      .set({ bytes: 5_242_880 })
      .where(eq(schema.mediaAsset.userId, userId));
    const rows = Array.from({ length: 99 }, () => ({
      id: randomUUID(),
      userId,
      cardId,
      side: 'back',
      kind: 'image',
      mime: 'image/png',
      bytes: 5_242_880,
      storageKey: 'x',
      status: 'ready',
    }));
    await t.db.insert(schema.mediaAsset).values(rows);
    const res = await reserve({ bytes: 1 });
    expect(res.status).toBe(413);
    expect(await res.json()).toMatchObject({ code: 'media_quota_exceeded' });
  });

  it('purges pending assets older than 24 h, with their objects', async () => {
    const id = randomUUID();
    await t.db.insert(schema.mediaAsset).values({
      id,
      userId,
      cardId,
      side: 'front',
      kind: 'image',
      mime: 'image/png',
      bytes: 10,
      storageKey: keyOf(id),
      status: 'pending',
      createdAt: new Date(FIXED_NOW.getTime() - 25 * 3_600_000),
    });
    fs.upload(keyOf(id), new Uint8Array(10), 'image/png');
    const fresh = randomUUID();
    await t.db.insert(schema.mediaAsset).values({
      id: fresh,
      userId,
      cardId,
      side: 'front',
      kind: 'image',
      mime: 'image/png',
      bytes: 10,
      storageKey: keyOf(fresh),
      status: 'pending',
      createdAt: new Date(FIXED_NOW.getTime() - 3_600_000),
    });
    await reserve();
    expect(await mediaRow(id)).toBeUndefined();
    expect(fs.objects.has(keyOf(id))).toBe(false);
    expect(await mediaRow(fresh)).toBeDefined();
  });
});

describe('POST /media/{id}/complete', () => {
  it('marks the asset ready after checking size and type, and counts its bytes', async () => {
    const id = await ready(1234);
    expect(await mediaRow(id)).toMatchObject({ status: 'ready' });
    expect((await statsRow()).mediaBytes).toBe(1234);
  });

  it('is idempotent', async () => {
    const id = await ready(500);
    expect((await h.call(userId, `/media/${id}/complete`, { method: 'POST' })).status).toBe(200);
    expect((await statsRow()).mediaBytes).toBe(500);
  });

  it('fails with 422 when the object is missing', async () => {
    const { mediaId } = (await (await reserve()).json()) as { mediaId: string };
    expect((await h.call(userId, `/media/${mediaId}/complete`, { method: 'POST' })).status).toBe(
      422,
    );
  });

  it('fails with 422 and removes the object when size or type differ from the reservation', async () => {
    const a = (await (await reserve({ bytes: 1000 })).json()) as { mediaId: string };
    fs.upload(keyOf(a.mediaId), new Uint8Array(999), 'image/png');
    expect((await h.call(userId, `/media/${a.mediaId}/complete`, { method: 'POST' })).status).toBe(
      422,
    );
    expect(fs.objects.has(keyOf(a.mediaId))).toBe(false);
    const b = (await (await reserve({ bytes: 10 })).json()) as { mediaId: string };
    fs.upload(keyOf(b.mediaId), new Uint8Array(10), 'image/jpeg');
    expect((await h.call(userId, `/media/${b.mediaId}/complete`, { method: 'POST' })).status).toBe(
      422,
    );
    expect((await mediaRow(b.mediaId))!.status).toBe('pending');
  });

  it("is 404 for another user's asset", async () => {
    const { mediaId } = (await (await reserve()).json()) as { mediaId: string };
    const other = await createUser(t.db);
    expect((await h.call(other.id, `/media/${mediaId}/complete`, { method: 'POST' })).status).toBe(
      404,
    );
  });
});

describe('GET /media/{id}', () => {
  it('redirects the owner (302) to a signed URL', async () => {
    const id = await ready();
    const res = await h.call(userId, `/media/${id}`);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toContain(keyOf(id));
  });

  it('is 404 for others, for pending and for unknown assets', async () => {
    const id = await ready();
    const other = await createUser(t.db);
    expect((await h.call(other.id, `/media/${id}`)).status).toBe(404);
    const { mediaId } = (await (await reserve()).json()) as { mediaId: string };
    expect((await h.call(userId, `/media/${mediaId}`)).status).toBe(404);
    expect((await h.call(userId, `/media/${randomUUID()}`)).status).toBe(404);
  });
});

describe('DELETE /media/{id}', () => {
  it('removes the object, tombstones the row and frees the quota', async () => {
    const id = await ready(700);
    expect((await h.call(userId, `/media/${id}`, { method: 'DELETE' })).status).toBe(204);
    expect(fs.objects.has(keyOf(id))).toBe(false);
    expect((await mediaRow(id))!.deletedAt).not.toBeNull();
    expect((await statsRow()).mediaBytes).toBe(0);
    expect((await h.call(userId, `/media/${id}`)).status).toBe(404);
  });

  it("cannot delete another user's media", async () => {
    const id = await ready();
    const other = await createUser(t.db);
    expect((await h.call(other.id, `/media/${id}`, { method: 'DELETE' })).status).toBe(404);
    expect(fs.objects.has(keyOf(id))).toBe(true);
  });
});
