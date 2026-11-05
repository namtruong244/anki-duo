import { existsSync } from 'node:fs';
import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { getDb } from './db/client.js';
import { createAuth } from './auth.js';
import { createStorage } from './storage.js';

const envFile = new URL('../.env', import.meta.url);
if (existsSync(envFile)) {
  process.loadEnvFile(envFile);
}

const env = { ...process.env, NODE_ENV: process.env.NODE_ENV ?? 'development' };
const db = getDb();
const app = createApp({
  db,
  env,
  now: () => new Date(),
  storage: createStorage(env),
  auth: createAuth({ db, env }),
});
const port = Number(process.env.PORT ?? 8787);
serve({ fetch: app.fetch, port }, () => console.log(`api listening on :${port}`));
