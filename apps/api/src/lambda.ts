import { handle } from 'hono/aws-lambda';
import { createApp } from './app.js';
import { getDb } from './db/client.js';
import { createAuth } from './auth.js';

const db = getDb();
const app = createApp({
  db,
  env: process.env,
  now: () => new Date(),
  auth: createAuth({ db, env: process.env }),
});

export const handler = handle(app);
