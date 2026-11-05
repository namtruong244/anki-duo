import { drizzle as drizzleNodePg } from 'drizzle-orm/node-postgres';
import { drizzle as drizzleNeon } from 'drizzle-orm/neon-serverless';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import * as schema from './schema/index.js';

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;
export { schema };

let cached: { url: string; db: Db } | undefined;

/**
 * Production uses Neon's serverless driver (WebSocket pool per Lambda container, so transactions
 * work with no connection pooler). Any other Postgres URL, e.g. local dev, uses `pg`.
 * Tests inject a PGlite database instead (tests/helpers/db.ts).
 */
export function getDb(url = process.env.DATABASE_URL): Db {
  if (!url) throw new Error('DATABASE_URL is not set');
  if (cached?.url === url) return cached.db;
  const db: Db = /\.neon\.tech/.test(url)
    ? (drizzleNeon(url, { schema }) as unknown as Db)
    : (drizzleNodePg(url, { schema }) as unknown as Db);
  cached = { url, db };
  return db;
}
