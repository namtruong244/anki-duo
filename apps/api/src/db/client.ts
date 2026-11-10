import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { drizzle as drizzleNodePg } from 'drizzle-orm/node-postgres';
import { drizzle as drizzleNeon } from 'drizzle-orm/neon-serverless';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import { PGlite } from '@electric-sql/pglite';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import * as schema from './schema/index.js';

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;
export { schema };

let cached: { url: string; db: Db } | undefined;

/**
 * Production uses Neon's serverless driver (WebSocket pool per Lambda container, so transactions
 * work with no connection pooler). PGlite URLs (e.g. `pglite://.pgdata`) run an embedded
 * in-process Postgres storing to a directory. Any other Postgres URL, e.g. local dev, uses `pg`.
 * Tests inject a PGlite database instead (tests/helpers/db.ts).
 */
export function getDb(url = process.env.DATABASE_URL): Db {
  if (!url) throw new Error('DATABASE_URL is not set');
  if (cached?.url === url) return cached.db;
  let db: Db;
  if (url.startsWith('pglite://')) {
    const rawPath = url.slice('pglite://'.length);
    const dataDir = rawPath
      ? isAbsolute(rawPath)
        ? rawPath
        : resolve(fileURLToPath(new URL('../../', import.meta.url)), rawPath)
      : undefined;
    const pg = new PGlite(dataDir);
    db = drizzlePglite(pg, { schema }) as unknown as Db;
  } else if (/\.neon\.tech/.test(url)) {
    db = drizzleNeon(url, { schema }) as unknown as Db;
  } else {
    db = drizzleNodePg(url, { schema }) as unknown as Db;
  }
  cached = { url, db };
  return db;
}
