import { expect, test } from '@playwright/test';
import {
  E2E_BASE_URL,
  gradeButton,
  goOffline,
  goOnline,
  readTable,
  showAnswer,
  signIn,
  startReview,
  waitForEmptyOutbox,
} from './helpers';

// V3, SC-005. Needs `pnpm db:seed --scenario=heavy` (thousands of due cards) and E2E_DECK="Heavy deck".
test.skip(!E2E_BASE_URL, 'set E2E_BASE_URL to run against a heavy-seeded stack');
test.use({ baseURL: E2E_BASE_URL ?? 'http://localhost:5173', locale: 'en-US' });
test.setTimeout(15 * 60_000);

const TARGET = 500;

/** Deterministic pseudo-random so a failure can be replayed. */
function rng(seed: number) {
  let s = seed;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
}

interface ServerCard {
  id: string;
  fsrs: unknown;
}

async function serverCards(page: import('@playwright/test').Page): Promise<ServerCard[]> {
  const deviceId = (await readTable<{ key: string; value: string }>(page, 'meta')).find(
    (m) => m.key === 'deviceId',
  )!.value;
  const out: ServerCard[] = [];
  let cursor = '0';
  for (;;) {
    const res = await page.request.get(
      `/api/v1/sync/pull?cursor=${cursor}&limit=2000&deviceId=${deviceId}`,
    );
    expect(res.ok()).toBe(true);
    const body = await res.json();
    out.push(...body.cards);
    cursor = body.cursor;
    if (!body.hasMore) return out;
  }
}

test('500 grades with random offline toggles and reloads end with every review on the server', async ({
  page,
  context,
}) => {
  const rand = rng(500);
  await signIn(page);
  await startReview(page, process.env.E2E_DECK ?? 'Heavy deck');
  const deck = page.url();

  let graded = 0;
  while (graded < TARGET) {
    if (await page.getByRole('heading', { name: 'Session complete' }).isVisible()) {
      await page.goto(deck.replace(/\?.*/, ''));
    }
    if (await page.getByRole('dialog', { name: 'Continue your session?' }).isVisible()) {
      await page.getByRole('button', { name: 'Continue' }).click();
    }
    await showAnswer(page).click();
    await gradeButton(page, rand() < 0.15 ? 'Again' : 'Good').click();
    graded++;

    const r = rand();
    if (graded % 37 === 0) await goOffline(context);
    if (graded % 37 === 11) await goOnline(context);
    if (r < 0.01) {
      await page.reload(); // reloads mid-session: the session resumes from IndexedDB
      if (await page.getByRole('dialog', { name: 'Continue your session?' }).isVisible()) {
        await page.getByRole('button', { name: 'Continue' }).click();
      }
    }
  }

  await goOnline(context);
  await waitForEmptyOutbox(page);

  const reviewsLocal = await readTable<{ id: string }>(page, 'cards');
  const server = new Map((await serverCards(page)).map((c) => [c.id, c.fsrs]));
  // The local copy must equal the server's replayed state for every card.
  for (const c of reviewsLocal as unknown as ServerCard[]) {
    expect(c.fsrs, `card ${c.id}`).toEqual(server.get(c.id));
  }

  // Exactly TARGET non-revoked reviews were stored: the deck export carries the history (US2).
  const decks = await readTable<{ id: string; name: string }>(page, 'decks');
  const id = decks.find((d) => d.name === (process.env.E2E_DECK ?? 'Heavy deck'))!.id;
  const exported = await (await page.request.get(`/api/v1/decks/${id}/export`)).json();
  const logs = (exported.cards as { reviews: { revokedAt?: string | null }[] }[]).flatMap(
    (c) => c.reviews,
  );
  const baseline = Number(process.env.E2E_BASELINE_REVIEWS ?? 0);
  expect(logs.filter((l) => !l.revokedAt).length - baseline).toBe(TARGET);
});
