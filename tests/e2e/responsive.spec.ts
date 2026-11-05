import { expect, test } from '@playwright/test';
import { DECK, E2E_BASE_URL, signIn } from './helpers';

// V10, SC-007: no horizontal scroll at 320, 768 and 1440 px on every primary screen.
test.skip(!E2E_BASE_URL, 'set E2E_BASE_URL to run against a seeded stack');
test.use({ baseURL: E2E_BASE_URL ?? 'http://localhost:5173', locale: 'en-US' });

const WIDTHS = [320, 768, 1440];

async function noHorizontalScroll(page: import('@playwright/test').Page) {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
}

for (const width of WIDTHS) {
  test.describe(`${width}px`, () => {
    test.use({ viewport: { width, height: 800 } });

    test.beforeEach(async ({ page }) => {
      await signIn(page);
    });

    const screens: [string, string][] = [
      ['home', '/'],
      ['decks', '/decks'],
      ['dashboard', '/dashboard'],
      ['settings', '/settings'],
    ];
    for (const [name, path] of screens) {
      test(`${name} has no horizontal scroll`, async ({ page }) => {
        await page.goto(path);
        await page.waitForLoadState('networkidle');
        await noHorizontalScroll(page);
      });
    }

    test('path has no horizontal scroll', async ({ page }) => {
      await page.goto('/decks');
      await page
        .getByRole('listitem')
        .filter({ hasText: DECK })
        .getByRole('link')
        .first()
        .click()
        .catch(() => undefined);
      await page.goto('/path');
      await page.waitForLoadState('networkidle');
      await noHorizontalScroll(page);
    });

    test('session has no horizontal scroll, front and back', async ({ page }) => {
      await page.goto('/decks');
      await page
        .getByRole('listitem')
        .filter({ hasText: DECK })
        .getByRole('button', { name: 'Review' })
        .click();
      await expect(page).toHaveURL(/\/session\//);
      await noHorizontalScroll(page);
      await page.getByRole('button', { name: 'Show answer' }).click();
      await noHorizontalScroll(page);
    });

    test('card editor has no horizontal scroll', async ({ page }) => {
      await page.goto('/decks');
      await page
        .getByRole('listitem')
        .filter({ hasText: DECK })
        .getByRole('link', { name: /cards/i })
        .first()
        .click();
      await page
        .getByRole('link', { name: /new card|add/i })
        .first()
        .click();
      await noHorizontalScroll(page);
    });

    test('import has no horizontal scroll', async ({ page }) => {
      await page.goto('/decks');
      await page
        .getByRole('listitem')
        .filter({ hasText: DECK })
        .getByRole('link', { name: /import/i })
        .first()
        .click();
      await noHorizontalScroll(page);
    });
  });
}
