import { expect, test } from '@playwright/test';

// FR-032. Needs a production build (`pnpm --filter @anki-duo/web build && vite preview`), because
// the service worker is not emitted by the dev server. PWA_BASE_URL points at that preview.
const base = process.env.PWA_BASE_URL;
test.skip(!base, 'set PWA_BASE_URL to a built preview of apps/web');
test.use({ baseURL: base ?? 'http://localhost:4173' });

test('the manifest is valid', async ({ page, request }) => {
  await page.goto('/');
  const href = await page.locator('link[rel="manifest"]').getAttribute('href');
  expect(href).toBeTruthy();
  const manifest = await (await request.get(href!)).json();
  expect(manifest.name).toBeTruthy();
  expect(manifest.display).toBe('standalone');
  const sizes = (manifest.icons as { sizes: string }[]).map((i) => i.sizes);
  expect(sizes).toContain('192x192');
  expect(sizes).toContain('512x512');
  for (const icon of manifest.icons as { src: string }[]) {
    const res = await request.get(new URL(icon.src, page.url()).toString());
    expect(res.ok()).toBe(true);
  }
});

test('the service worker is registered and controls the page', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  expect(await page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
});

test('offline, reloading / still shows the app shell', async ({ page, context }) => {
  await page.goto('/');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('#root')).not.toBeEmpty();
  await expect(page.getByRole('heading', { name: /Sign in|Đăng nhập/ })).toBeVisible();
});
