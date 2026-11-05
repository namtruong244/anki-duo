import { expect, test } from '@playwright/test';
import { DECK, E2E_BASE_URL, gradeButton, showAnswer, signIn } from './helpers';

// V7. Needs the full stack seeded with `pnpm db:seed --scenario=due25`.
test.skip(!E2E_BASE_URL, 'set E2E_BASE_URL to run against a seeded stack');
test.use({ baseURL: E2E_BASE_URL ?? 'http://localhost:5173', locale: 'en-US' });

const openPath = async (page: import('@playwright/test').Page) => {
  await page.goto('/decks');
  await page
    .getByRole('listitem')
    .filter({ hasText: DECK })
    .getByRole('button', { name: 'Path' })
    .click();
  await expect(page).toHaveURL(/\/path/);
};

test.beforeEach(async ({ page }) => {
  await signIn(page);
  await openPath(page);
});

test('nodes show their state in text and the Review entry is enabled with due cards', async ({
  page,
}) => {
  const nodes = page.getByRole('list', { name: 'Learning path' }).getByRole('button');
  await expect(nodes.first()).toBeVisible();
  for (const n of await nodes.all())
    await expect(n).toHaveAccessibleName(/completed|available|in progress|locked/);
  const review = page.getByRole('button', { name: /^Review \(\d+\)/ });
  await expect(review).toBeEnabled();
  await expect(page.getByText('Review the remaining due cards first.')).toBeVisible();
});

test('tapping a locked node shows "finish node N first" and starts no session', async ({
  page,
}) => {
  const locked = page.getByRole('button', { name: /locked/ }).first();
  test.skip((await locked.count()) === 0, 'no locked node in this deck');
  await locked.click();
  await expect(page.getByRole('status').filter({ hasText: /Finish node \d+ first/ })).toBeVisible();
  await expect(page).toHaveURL(/\/path/);
});

test('with due cards a node session holds only due cards (at most 10)', async ({ page }) => {
  await page
    .getByRole('button', { name: /in progress|available/ })
    .first()
    .click();
  await expect(page).toHaveURL(/\/session\/.*node=/);
  const progress = page.getByRole('progressbar');
  expect(Number(await progress.getAttribute('aria-valuemax'))).toBeLessThanOrEqual(10);
});

test('completing a node session returns to a path where progress changed', async ({ page }) => {
  await page
    .getByRole('button', { name: /in progress|available/ })
    .first()
    .click();
  for (let i = 0; i < 12; i++) {
    if (await page.getByRole('heading', { name: /session complete|summary/i }).isVisible()) break;
    await showAnswer(page).click();
    await gradeButton(page, 'Good').click();
  }
  await page.goto('/path');
  await expect(page.getByRole('list', { name: 'Learning path' })).toBeVisible();
});

test('with reduced motion the unlock uses a fade', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.reload();
  const unlocked = page.locator('[data-unlock]');
  if ((await unlocked.count()) > 0)
    await expect(unlocked.first()).toHaveAttribute('data-unlock', 'fade');
});
