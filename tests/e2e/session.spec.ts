import { expect, test } from '@playwright/test';
import { E2E_BASE_URL, gradeButton, showAnswer, signIn, startReview } from './helpers';

// V2, SC-001. Needs the full stack and a seeded learner (see helpers.ts).
test.skip(!E2E_BASE_URL, 'set E2E_BASE_URL to run against a seeded stack');
test.use({ baseURL: E2E_BASE_URL ?? 'http://localhost:5173', locale: 'en-US' });

test.beforeEach(async ({ page }) => {
  await signIn(page);
  await startReview(page);
});

test('touch: tap to reveal, tap to grade, progress advances', async ({ page }, info) => {
  test.skip(info.project.name !== 'mobile', 'touch flow runs on the mobile project');
  const bar = page.getByRole('progressbar');
  const before = Number(await bar.getAttribute('aria-valuenow'));
  await showAnswer(page).tap();
  await expect(gradeButton(page, 'Good')).toBeVisible();
  await gradeButton(page, 'Good').tap();
  await expect(showAnswer(page)).toBeVisible();
  expect(Number(await bar.getAttribute('aria-valuenow'))).toBeGreaterThanOrEqual(before);
});

test('keyboard: Space reveals, 1-4 grade, Z undoes', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'keyboard flow runs on the desktop project');
  const front = await page.getByRole('article').innerText();
  await page.keyboard.press('Space');
  await expect(gradeButton(page, 'Easy')).toBeVisible();
  await page.keyboard.press('3');
  await expect(showAnswer(page)).toBeVisible();
  expect(await page.getByRole('article').innerText()).not.toBe(front);
  await page.keyboard.press('z');
  await expect(page.getByRole('article')).toContainText(front);
});

test('four intervals are shown on reveal (FR-002)', async ({ page }) => {
  await showAnswer(page).click();
  for (const g of ['Again', 'Hard', 'Good', 'Easy'] as const) {
    await expect(gradeButton(page, g)).toHaveText(new RegExp(`^${g} · .+`));
  }
});

test('95% of grade → next-card paints take at most 100 ms with the CPU throttled x4 (SC-001)', async ({
  page,
  context,
}, info) => {
  test.skip(info.project.name !== 'desktop', 'throttling needs Chromium DevTools');
  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });

  const samples: number[] = [];
  for (let i = 0; i < 15; i++) {
    if (await page.getByRole('heading', { name: 'Session complete' }).isVisible()) break;
    await page.keyboard.press('Space');
    await expect(gradeButton(page, 'Good')).toBeVisible();
    const ms = await page.evaluate(
      () =>
        new Promise<number>((resolve) => {
          const t0 = performance.now();
          const obs = new MutationObserver(() => {
            obs.disconnect();
            requestAnimationFrame(() => resolve(performance.now() - t0));
          });
          obs.observe(document.body, { childList: true, subtree: true, characterData: true });
          window.dispatchEvent(new KeyboardEvent('keydown', { key: '3' }));
        }),
    );
    samples.push(ms);
  }
  expect(samples.length).toBeGreaterThanOrEqual(10);
  const sorted = [...samples].sort((a, b) => a - b);
  const p95 = sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)]!;
  info.annotations.push({ type: 'p95-ms', description: p95.toFixed(1) });
  expect(p95).toBeLessThanOrEqual(100);
});

// FR-031, SC-009: switching language is immediate and does not lose the screen or the session.
test('language switch keeps the in-progress session (FR-031)', async ({ page }) => {
  // Grade one card, leave to Settings, switch to Vietnamese, then come back.
  await showAnswer(page).click();
  await gradeButton(page, 'Good').click();
  await expect(showAnswer(page)).toBeVisible();
  await page.goto('/settings');
  await page.getByLabel('Language').selectOption('vi');
  await expect(page.getByRole('heading', { name: 'Cài đặt', level: 1 })).toBeVisible();
  // Still on the same screen: no reload, no navigation.
  await expect(page).toHaveURL(/\/settings$/);
  await page.goto('/decks');
  await page.getByRole('listitem').first().getByRole('button').first().click();
  await expect(page.getByRole('dialog', { name: 'Tiếp tục phiên học?' })).toBeVisible();
  await page.getByRole('button', { name: 'Tiếp tục' }).click();
  await expect(page.getByRole('button', { name: 'Hiện đáp án' })).toBeVisible();
  // Put it back so other specs find English.
  await page.goto('/settings');
  await page.getByLabel('Ngôn ngữ').selectOption('en');
});
