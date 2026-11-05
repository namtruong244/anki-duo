import { expect, test } from '@playwright/test';
import { DECK, E2E_BASE_URL, signIn } from './helpers';

// V9. Needs the full stack seeded with `pnpm db:seed` (90 days of history).
test.skip(!E2E_BASE_URL, 'set E2E_BASE_URL to run against a seeded stack');
test.use({ baseURL: E2E_BASE_URL ?? 'http://localhost:5173', locale: 'en-US' });

test.beforeEach(async ({ page }) => {
  await signIn(page);
  await page.goto('/dashboard');
});

const legend = (page: import('@playwright/test').Page) =>
  page.getByRole('list', { name: 'Cards by status' });
const total = async (page: import('@playwright/test').Page) => {
  const nums = await legend(page).getByRole('listitem').locator('span.font-bold').allInnerTexts();
  return nums.reduce((n, x) => n + Number(x), 0);
};

test('shows streaks, XP, donut and heatmap for the seeded learner', async ({ page }) => {
  await expect(page.getByText('Current streak')).toBeVisible();
  await expect(page.getByText('Total XP')).toBeVisible();
  await expect(page.getByTestId('donut-centre')).toBeVisible();
  expect(await total(page)).toBe(105);
  await expect(page.getByTestId('heatmap').getByRole('img')).toHaveCount(365);
});

test('the deck filter updates every figure', async ({ page }) => {
  await page.getByLabel('Deck').selectOption({ label: DECK });
  expect(await total(page)).toBe(60);
  await page.getByLabel('Deck').selectOption({ label: 'Media sample' });
  expect(await total(page)).toBe(5);
});

test('heatmap cells can be reached and moved between with the keyboard', async ({ page }) => {
  const cells = page.getByTestId('heatmap').getByRole('img');
  await cells.last().focus();
  await expect(page.getByRole('tooltip')).toBeVisible();
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByRole('tooltip')).toBeVisible();
  const focused = await page.evaluate(() => document.activeElement?.getAttribute('aria-label'));
  expect(focused).toMatch(/\d{4}-\d{2}-\d{2}: \d+ reviews?/);
});
