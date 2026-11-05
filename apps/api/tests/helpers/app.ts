import type { AppDeps } from '../../src/app.js';
import type { Db } from '../../src/db/client.js';
import { FIXED_NOW } from './db.js';

export const ORIGIN_HEADERS = { 'x-origin-secret': 'test-origin' };

export function testDeps(db: Db, over: Partial<AppDeps> = {}): AppDeps {
  return {
    db,
    now: () => FIXED_NOW,
    log: () => {},
    env: {
      ORIGIN_SECRET: 'test-origin',
      BETTER_AUTH_SECRET: 'test-secret-test-secret-test-secret!!',
    },
    ...over,
  };
}
