import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { migrate as migrateNode } from 'drizzle-orm/node-postgres/migrator';
import { migrate as migrateNeon } from 'drizzle-orm/neon-serverless/migrator';
import { getDb } from '../src/db/client.js';

const envFile = new URL('../.env', import.meta.url);
if (existsSync(envFile)) {
  process.loadEnvFile(envFile);
}

const url = process.env.DATABASE_URL ?? '';
const folder = fileURLToPath(new URL('../drizzle', import.meta.url));
const db = getDb(url) as never;
await (/\.neon\.tech/.test(url)
  ? migrateNeon(db, { migrationsFolder: folder })
  : migrateNode(db, { migrationsFolder: folder }));
console.log('migrations applied');
process.exit(0);
