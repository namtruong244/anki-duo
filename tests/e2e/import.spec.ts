import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { E2E_BASE_URL, signIn } from './helpers';

// V6, SC-002, SC-006. Needs the full stack and a seeded learner (see helpers.ts).
test.skip(!E2E_BASE_URL, 'set E2E_BASE_URL to run against a running stack');
test.use({ baseURL: E2E_BASE_URL ?? 'http://localhost:5173', locale: 'en-US' });

const fixtures = resolve(import.meta.dirname, '../../packages/fixtures/import');
const file = (name: string) => resolve(fixtures, name);
const unique = (p: string) => `${p} ${Date.now()}`;

async function newDeck(page: Page, name: string) {
  await page.goto('/decks');
  await page.getByRole('button', { name: 'New deck' }).click();
  await page.getByLabel('Name').fill(name);
  await page.getByRole('button', { name: 'Create deck' }).click();
  await expect(page.getByRole('listitem').filter({ hasText: name })).toBeVisible();
}

async function openImport(page: Page, name: string) {
  await page
    .getByRole('listitem')
    .filter({ hasText: name })
    .getByRole('button', { name: 'Import' })
    .click();
}

test.beforeEach(async ({ page }) => {
  await signIn(page);
});

test('basic-200.tsv: deck → import → first graded card in under 3 minutes (SC-002)', async ({
  page,
}) => {
  const started = Date.now();
  const name = unique('E2E import');
  await newDeck(page, name);
  await openImport(page, name);
  await page.getByTestId('import-file').setInputFiles(file('basic-200.tsv'));
  await expect(page.getByText('200 rows')).toBeVisible();
  await expect(page.getByText('0 invalid rows')).toBeVisible();
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await expect(page.getByText('Import finished')).toBeVisible();
  await expect(page.getByText('Imported:').locator('strong').first()).toHaveText('200');

  await page.getByRole('button', { name: 'Back to decks' }).click();
  await page
    .getByRole('listitem')
    .filter({ hasText: name })
    .getByRole('button', { name: 'Review' })
    .click();
  await page.getByRole('button', { name: 'Show answer' }).click();
  await page.getByRole('button', { name: /^Good ·/ }).click();
  expect(Date.now() - started).toBeLessThan(3 * 60_000);
});

test('10000-rows.csv finishes in under 15 s with accurate counts (SC-006)', async ({ page }) => {
  const name = unique('E2E bulk');
  await newDeck(page, name);
  await openImport(page, name);
  await page.getByTestId('import-file').setInputFiles(file('10000-rows.csv'));
  await expect(page.getByText('10000 rows')).toBeVisible();
  const t0 = Date.now();
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await expect(page.getByText('Import finished')).toBeVisible({ timeout: 15_000 });
  expect(Date.now() - t0).toBeLessThan(15_000);
  await expect(page.getByText('Imported:').locator('strong').first()).toHaveText('10000');
});

test('skipped rows are reported and can be downloaded as CSV', async ({ page }) => {
  const name = unique('E2E report');
  await newDeck(page, name);
  await openImport(page, name);
  await page.getByTestId('import-file').setInputFiles(file('malformed.csv'));
  await expect(page.getByText('3 invalid rows')).toBeVisible();
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await expect(page.getByText('Skipped rows')).toBeVisible();
  const row3 = page.getByRole('row').filter({ hasText: 'Wrong number of columns' }).first();
  await expect(row3).toBeVisible();

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Download skipped rows (CSV)' }).click(),
  ]);
  const text = readFileSync(await download.path()!, 'utf8');
  expect(text.split('\n')[0]).toBe('Line,Reason');
  expect(text).toContain('3,Wrong number of columns');
  expect(text).toContain('4,Front is empty');
});

test('a non-UTF-8 file is rejected before any card is created', async ({ page }) => {
  const name = unique('E2E latin1');
  await newDeck(page, name);
  await openImport(page, name);
  await page.getByTestId('import-file').setInputFiles(file('latin1.csv'));
  await expect(page.getByRole('alert')).toContainText('not UTF-8');
});
