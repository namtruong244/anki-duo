import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import { newCard, encodeState } from '@anki-duo/domain';
import { schema, type Db } from '../../src/db/client.js';

const migrationsFolder = fileURLToPath(new URL('../../drizzle', import.meta.url));

export interface TestDb {
  db: Db;
  pg: PGlite;
  close(): Promise<void>;
}

/** A fresh in-process Postgres (PGlite) with every migration applied. */
export async function createTestDb(): Promise<TestDb> {
  const pg = new PGlite();
  const db = drizzle(pg, { schema });
  await migrate(db, { migrationsFolder });
  return { db: db as unknown as Db, pg, close: () => pg.close() };
}

/** Applies migrations up to (not including) index `count`, for migration tests. */
export async function createTestDbAt(
  migrationCount: number,
): Promise<TestDb & { applyRest(): Promise<void> }> {
  const { readFileSync, readdirSync } = await import('node:fs');
  const pg = new PGlite();
  const files = readdirSync(migrationsFolder)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  const run = async (list: string[]) => {
    for (const f of list) {
      for (const stmt of readFileSync(`${migrationsFolder}/${f}`, 'utf8').split(
        '--> statement-breakpoint',
      )) {
        if (stmt.trim()) await pg.exec(stmt);
      }
    }
  };
  await run(files.slice(0, migrationCount));
  const db = drizzle(pg, { schema }) as unknown as Db;
  return { db, pg, close: () => pg.close(), applyRest: () => run(files.slice(migrationCount)) };
}

export const FIXED_NOW = new Date('2026-03-01T12:00:00.000Z');
export const fixedClock = () => FIXED_NOW;

export async function createUser(db: Db, over: Partial<typeof schema.user.$inferInsert> = {}) {
  const id = over.id ?? randomUUID();
  const [u] = await db
    .insert(schema.user)
    .values({ id, name: 'Test', email: `${id}@example.test`, emailVerified: true, ...over })
    .returning();
  await db.insert(schema.learnerSettings).values({ userId: id }).onConflictDoNothing();
  await db.insert(schema.learnerStats).values({ userId: id }).onConflictDoNothing();
  return u!;
}

export async function createDeck(
  db: Db,
  userId: string,
  over: Partial<typeof schema.deck.$inferInsert> = {},
) {
  const [d] = await db
    .insert(schema.deck)
    .values({ id: randomUUID(), userId, name: `Deck ${randomUUID().slice(0, 6)}`, ...over })
    .returning();
  return d!;
}

export async function createCard(
  db: Db,
  userId: string,
  deckId: string,
  over: Partial<typeof schema.card.$inferInsert> = {},
) {
  const [c] = await db
    .insert(schema.card)
    .values({
      id: randomUUID(),
      userId,
      deckId,
      position: 0,
      nodeIndex: 0,
      front: 'front',
      back: 'back',
      frontNorm: 'front',
      due: FIXED_NOW,
      ...over,
    })
    .returning();
  return c!;
}

export const initialStateArray = (now = FIXED_NOW) => encodeState(newCard(now));

/** Inserts `count` live cards in one statement, for limit tests. */
export async function bulkCards(db: Db, userId: string, deckId: string, count: number) {
  const { sql } = await import('drizzle-orm');
  await db.execute(sql`
    insert into card (id, user_id, deck_id, position, node_index, front, front_norm, due)
    select gen_random_uuid(), ${userId}, ${deckId}, 1000000 + g, 1000000 + g, 'bulk ' || g, 'bulk ' || g, now()
    from generate_series(1, ${count}) g`);
}
