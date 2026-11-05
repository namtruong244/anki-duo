import type { BrowserContext, Page } from '@playwright/test';
import { expect } from '@playwright/test';

/**
 * Environment for the US1 end-to-end specs. They need the full stack running against a database
 * seeded with `pnpm db:seed --scenario=due25` (or `heavy` for offline.spec.ts):
 *   E2E_BASE_URL=http://localhost:5173 pnpm exec playwright test tests/e2e/session.spec.ts
 */
export const E2E_BASE_URL = process.env.E2E_BASE_URL;
export const DEMO = { email: 'demo@anki-duo.local', password: 'demo-password-123' };
export const DECK = process.env.E2E_DECK ?? 'Từ vựng N3';

export async function signIn(page: Page) {
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(DEMO.email);
  await page.getByLabel('Password').fill(DEMO.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/$/);
}

/** Opens a review session for a deck from the deck list. */
export async function startReview(page: Page, deck = DECK) {
  await page.goto('/decks');
  const row = page.getByRole('listitem').filter({ hasText: deck });
  await row.getByRole('button', { name: 'Review' }).click();
  await expect(page).toHaveURL(/\/session\//);
}

export const showAnswer = (page: Page) => page.getByRole('button', { name: 'Show answer' });
export const gradeButton = (page: Page, grade: 'Again' | 'Hard' | 'Good' | 'Easy') =>
  page.getByRole('button', { name: new RegExp(`^${grade} ·`) });

/** Reads a table from the app's IndexedDB ("anki-duo"). */
export function readTable<T = unknown>(page: Page, table: string): Promise<T[]> {
  return page.evaluate(
    (name) =>
      new Promise<unknown[]>((resolve, reject) => {
        const open = indexedDB.open('anki-duo');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const req = db.transaction(name, 'readonly').objectStore(name).getAll();
          req.onsuccess = () => {
            db.close();
            resolve(req.result);
          };
          req.onerror = () => reject(req.error);
        };
      }),
    table,
  ) as Promise<T[]>;
}

export async function waitForEmptyOutbox(page: Page, timeout = 60_000) {
  await expect
    .poll(
      async () =>
        (await readTable<{ type: string }>(page, 'outbox')).filter((e) => e.type === 'review')
          .length,
      {
        timeout,
      },
    )
    .toBe(0);
}

export async function goOffline(context: BrowserContext) {
  await context.setOffline(true);
}
export async function goOnline(context: BrowserContext) {
  await context.setOffline(false);
}
