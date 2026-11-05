import { expect, test, type Page } from '@playwright/test';
import { replay, type FsrsState, type Grade } from '../../packages/domain/src/index';
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

// V4, SC-008. Two browser contexts, one learner. Needs a seeded stack (see helpers.ts).
test.skip(!E2E_BASE_URL, 'set E2E_BASE_URL to run against a seeded stack');
test.use({ baseURL: E2E_BASE_URL ?? 'http://localhost:5173', locale: 'en-US' });
test.setTimeout(5 * 60_000);

interface Card {
  id: string;
  fsrs: {
    state: FsrsState['state'];
    due: string;
    stability: number;
    difficulty: number;
    learningSteps: number;
    reps: number;
    lapses: number;
    lastReview: string | null;
  };
}
interface ReviewEvent {
  type: string;
  id: string;
  cardId: string;
  grade: Grade;
  reviewedAt: string;
}

const card = async (page: Page, id: string) =>
  (await readTable<Card>(page, 'cards')).find((c) => c.id === id)!;
const toDomain = (c: Card['fsrs']): FsrsState => ({
  ...c,
  due: new Date(c.due),
  lastReview: c.lastReview ? new Date(c.lastReview) : null,
});

async function openDevice(browser: import('@playwright/test').Browser) {
  const context = await browser.newContext({ baseURL: E2E_BASE_URL!, locale: 'en-US' });
  const page = await context.newPage();
  await signIn(page);
  await startReview(page);
  return { context, page };
}

test('a grade on device A shows up on device B within 60 s (SC-008)', async ({ browser }) => {
  const a = await openDevice(browser);
  const b = await openDevice(browser);
  await showAnswer(a.page).click();
  await gradeButton(a.page, 'Good').click();
  await expect
    .poll(
      async () =>
        (await readTable<ReviewEvent>(a.page, 'outbox')).filter((e) => e.type === 'review').length,
    )
    .toBe(0);
  // The card A graded is the one with a newer lastReview.
  const reviewed = (await readTable<Card>(a.page, 'cards')).find(
    (c) =>
      c.fsrs.reps > 0 && c.fsrs.lastReview && Date.now() - Date.parse(c.fsrs.lastReview) < 120_000,
  )!;
  await expect
    .poll(async () => (await card(b.page, reviewed.id)).fsrs.lastReview, {
      timeout: 60_000,
      intervals: [2000],
    })
    .toBe(reviewed.fsrs.lastReview);
  await a.context.close();
  await b.context.close();
});

test('the same card graded offline on both devices keeps both logs and replays in (reviewed_at, id) order', async ({
  browser,
}) => {
  const a = await openDevice(browser);
  const b = await openDevice(browser);
  // Both sessions start from the same queue, so both show the same first card.
  const firstFront = await a.page.getByRole('article').innerText();
  expect(await b.page.getByRole('article').innerText()).toBe(firstFront);

  await goOffline(a.context);
  await goOffline(b.context);
  await showAnswer(a.page).click();
  await gradeButton(a.page, 'Good').click();
  await showAnswer(b.page).click();
  await gradeButton(b.page, 'Again').click();

  const events = [
    ...(await readTable<ReviewEvent>(a.page, 'outbox')),
    ...(await readTable<ReviewEvent>(b.page, 'outbox')),
  ].filter((e) => e.type === 'review');
  expect(events).toHaveLength(2);
  expect(events[0]!.cardId).toBe(events[1]!.cardId);
  const target = events[0]!.cardId;

  await goOnline(a.context);
  await goOnline(b.context);
  await waitForEmptyOutbox(a.page);
  await waitForEmptyOutbox(b.page);

  // Rebuild the expected state from the state both devices started from.
  const expected = replay(
    toDomain((events as unknown as { stateBefore: Card['fsrs'] }[])[0]!.stateBefore),
    events.map((e) => ({
      id: e.id,
      kind: 'review' as const,
      grade: e.grade,
      reviewedAt: new Date(e.reviewedAt),
      revokedAt: null,
    })),
    { desiredRetention: 0.9, maximumIntervalDays: 36500 },
  );

  for (const page of [a.page, b.page]) {
    await expect
      .poll(async () => (await card(page, target)).fsrs.lastReview, {
        timeout: 60_000,
        intervals: [2000],
      })
      .toBe(expected.lastReview!.toISOString());
    const got = (await card(page, target)).fsrs;
    expect({
      state: got.state,
      due: got.due,
      stability: got.stability,
      reps: got.reps,
      lapses: got.lapses,
    }).toEqual({
      state: expected.state,
      due: expected.due.toISOString(),
      stability: expected.stability,
      reps: expected.reps,
      lapses: expected.lapses,
    });
  }
  await a.context.close();
  await b.context.close();
});
