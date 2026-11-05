import { migrate as migrateNode } from 'drizzle-orm/node-postgres/migrator';
import { migrate as migrateNeon } from 'drizzle-orm/neon-serverless/migrator';
import { fileURLToPath } from 'node:url';
import { getDb } from '../src/db/client.js';

const url = process.env.DATABASE_URL ?? '';
const folder = fileURLToPath(new URL('../drizzle', import.meta.url));
const db = getDb(url) as never;
await (/\.neon\.tech/.test(url)
  ? migrateNeon(db, { migrationsFolder: folder })
  : migrateNode(db, { migrationsFolder: folder }));
console.log('migrations applied');
process.exit(0);
