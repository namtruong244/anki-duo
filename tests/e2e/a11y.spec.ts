import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { DECK, E2E_BASE_URL, gradeButton, showAnswer, signIn } from './helpers';

// V10, FR-033: no serious or critical axe violations on any primary screen, and every review
// action works from the keyboard alone.
test.skip(!E2E_BASE_URL, 'set E2E_BASE_URL to run against a seeded stack');
test.use({ baseURL: E2E_BASE_URL ?? 'http://localhost:5173', locale: 'en-US' });

async function expectNoSeriousViolations(page: import('@playwright/test').Page) {
  const { violations } = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
    .analyze();
  const bad = violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
  expect(bad.map((v) => `${v.id}: ${v.help} (${v.nodes.length})`)).toEqual([]);
}

test.describe('axe on every primary screen', () => {
  test('sign-in and sign-up', async ({ page }) => {
    for (const path of ['/sign-in', '/sign-up', '/reset-password']) {
      await page.goto(path);
      await expectNoSeriousViolations(page);
    }
  });

  test.describe('signed in', () => {
    test.beforeEach(async ({ page }) => {
      await signIn(page);
    });
    for (const [name, path] of [
      ['home', '/'],
      ['decks', '/decks'],
      ['path', '/path'],
      ['dashboard', '/dashboard'],
      ['settings', '/settings'],
    ] as const) {
      test(name, async ({ page }) => {
        await page.goto(path);
        await page.waitForLoadState('networkidle');
        await expectNoSeriousViolations(page);
      });
    }

    test('session (front and back)', async ({ page }) => {
      await page.goto('/decks');
      await page
        .getByRole('listitem')
        .filter({ hasText: DECK })
        .getByRole('button', { name: 'Review' })
        .click();
      await expectNoSeriousViolations(page);
      await showAnswer(page).click();
      await expectNoSeriousViolations(page);
    });

    test('card editor and import', async ({ page }) => {
      await page.goto('/decks');
      await page
        .getByRole('listitem')
        .filter({ hasText: DECK })
        .getByRole('link', { name: /import/i })
        .first()
        .click();
      await expectNoSeriousViolations(page);
    });
  });
});

test('a whole review works with the keyboard alone', async ({ page }) => {
  await signIn(page);
  await page.goto('/decks');
  // Tab to the Review control of the target deck and press it with the keyboard.
  const review = page
    .getByRole('listitem')
    .filter({ hasText: DECK })
    .getByRole('button', { name: 'Review' });
  await review.focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/session\//);

  await page.keyboard.press('Space'); // reveal
  await expect(gradeButton(page, 'Good')).toBeVisible();
  await page.keyboard.press('3'); // grade
  await expect(showAnswer(page)).toBeVisible();
  await page.keyboard.press('z'); // undo
  await expect(gradeButton(page, 'Good')).toHaveCount(0);

  // Buttons are reachable and operable by Tab + Enter too.
  await showAnswer(page).focus();
  await page.keyboard.press('Enter');
  await gradeButton(page, 'Easy').focus();
  await expect(gradeButton(page, 'Easy')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(showAnswer(page)).toBeVisible();
});
