import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { migrate as migrateNode } from 'drizzle-orm/node-postgres/migrator';
import { migrate as migrateNeon } from 'drizzle-orm/neon-serverless/migrator';
import { migrate as migratePglite } from 'drizzle-orm/pglite/migrator';
import { getDb } from '../src/db/client.js';
import { backfill0005 } from '../src/db/backfill-0005.js';

const envFile = new URL('../.env', import.meta.url);
if (existsSync(envFile)) {
  process.loadEnvFile(envFile);
}

const url = process.env.DATABASE_URL ?? '';
const folder = fileURLToPath(new URL('../drizzle', import.meta.url));
const db = getDb(url) as never;
if (url.startsWith('pglite://')) {
  await migratePglite(db, { migrationsFolder: folder });
} else if (/\.neon\.tech/.test(url)) {
  await migrateNeon(db, { migrationsFolder: folder });
} else {
  await migrateNode(db, { migrationsFolder: folder });
}
// Data backfills run after the schema migrations; each one is idempotent.
const backfilled = await backfill0005(db);
console.log(`migrations applied (backfill-0005: ${backfilled} cards)`);
process.exit(0);
