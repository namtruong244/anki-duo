import { expect, test } from '@playwright/test';
import { E2E_BASE_URL, goOffline, goOnline, signIn } from './helpers';

// V5. Needs the full stack with object storage (MinIO) and a seeded learner (see helpers.ts).
test.skip(!E2E_BASE_URL, 'set E2E_BASE_URL to run against a running stack');
test.use({ baseURL: E2E_BASE_URL ?? 'http://localhost:5173', locale: 'en-US' });

// 1x1 transparent PNG.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);
const MP3 = Buffer.concat([Buffer.from([0xff, 0xfb, 0x90, 0x00]), Buffer.alloc(2048)]);

const unique = (p: string) => `${p} ${Date.now()}`;

test.beforeEach(async ({ page }) => {
  await signIn(page);
});

test('deck CRUD with a delete confirmation', async ({ page }) => {
  const name = unique('E2E deck');
  await page.goto('/decks');
  await page.getByRole('button', { name: 'New deck' }).click();
  await page.getByLabel('Name').fill(name);
  await page.getByRole('button', { name: 'Create deck' }).click();
  const row = page.getByRole('listitem').filter({ hasText: name });
  await expect(row).toBeVisible();

  await row.getByRole('button', { name: 'Deck settings' }).click();
  await page.getByLabel('Name').fill(`${name} renamed`);
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('listitem').filter({ hasText: `${name} renamed` })).toBeVisible();

  await page
    .getByRole('listitem')
    .filter({ hasText: `${name} renamed` })
    .getByRole('button', { name: 'Deck settings' })
    .click();
  await page.getByRole('button', { name: 'Delete deck' }).click();
  // The confirmation names the deck and its card count and nothing is deleted yet.
  await expect(
    page.getByText(new RegExp(`Delete "${name} renamed" and its 0 cards`)),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Delete deck' }).last().click();
  await expect(page.getByText(`${name} renamed`)).toHaveCount(0);
});

test('Markdown renders, scripts do not run; image and audio attach and render', async ({
  page,
}) => {
  const dialogs: string[] = [];
  page.on('dialog', (d) => {
    dialogs.push(d.message());
    void d.dismiss();
  });
  const name = unique('E2E media');
  await page.goto('/decks');
  await page.getByRole('button', { name: 'New deck' }).click();
  await page.getByLabel('Name').fill(name);
  await page.getByRole('button', { name: 'Create deck' }).click();
  await page
    .getByRole('listitem')
    .filter({ hasText: name })
    .getByRole('button', { name: 'Cards' })
    .click();
  await page.getByRole('button', { name: 'Add card' }).click();

  await page
    .getByLabel('Front')
    .fill('**bold** <script>alert(1)</script>\n\n| a | b |\n|---|---|\n| 1 | 2 |');
  await page.getByLabel('Back').fill('answer');
  await expect(page.locator('strong', { hasText: 'bold' })).toBeVisible();
  await expect(page.locator('table')).toBeVisible();
  await page.getByRole('button', { name: 'Save card' }).click();

  // Saved: now the media pickers appear on the edit view.
  await expect(page.getByTestId('media-input-front')).toBeAttached();
  await page
    .getByTestId('media-input-front')
    .setInputFiles({ name: 'dot.png', mimeType: 'image/png', buffer: PNG });
  await expect(page.getByRole('img', { name: 'dot.png' }).first()).toBeVisible();
  await page
    .getByTestId('media-input-back')
    .setInputFiles({ name: 'say.mp3', mimeType: 'audio/mpeg', buffer: MP3 });
  await expect(page.getByRole('button', { name: 'Replay' })).toBeVisible();
  await page.getByRole('button', { name: 'Save card' }).click();
  expect(dialogs).toEqual([]);

  // A 6 MB image is rejected with the limit shown.
  await page.getByRole('listitem').first().getByRole('link', { name: 'Edit' }).click();
  await page.getByTestId('media-input-front').setInputFiles({
    name: 'big.png',
    mimeType: 'image/png',
    buffer: Buffer.alloc(6 * 1024 * 1024),
  });
  await expect(page.getByRole('alert')).toContainText('5 MB');
});

test('offline: content actions are disabled with a message, review still works', async ({
  page,
  context,
}) => {
  await page.goto('/decks');
  await page.waitForLoadState('networkidle');
  await goOffline(context);
  await expect(page.getByRole('button', { name: 'New deck' })).toBeDisabled();
  await expect(page.getByText(/needs a connection/i).first()).toBeVisible();
  await page.goto('/decks').catch(() => undefined);
  const review = page.getByRole('button', { name: 'Review' }).first();
  await expect(review).toBeEnabled();
  await review.click();
  await expect(page).toHaveURL(/\/session\//);
  await expect(page.getByRole('button', { name: 'Show answer' })).toBeVisible();
  await goOnline(context);
});
