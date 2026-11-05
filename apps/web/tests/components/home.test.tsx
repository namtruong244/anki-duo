import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { studyDay } from '@anki-duo/domain';
import { initI18n } from '../../src/i18n';
import { dexieStore } from '../../src/client/store';
import type { Settings } from '../../src/client/local-store';
import { Celebration } from '../../src/components/session/Celebration';
import { HomePage } from '../../src/routes/home/HomePage';

const settings: Settings = {
  locale: 'en',
  timeZone: 'UTC',
  dayStartHour: 4,
  desiredRetention: 0.9,
  maximumIntervalDays: 36500,
  dailyXpGoal: 20,
  sessionSize: 20,
  soundEnabled: true,
  motion: 'system',
};
const dayOffset = (n: number) => studyDay(new Date(Date.now() + n * 86_400_000), 'UTC', 4);
const activity = (offset: number, xp: number, met: boolean) => ({
  studyDay: dayOffset(offset),
  reviews: xp / 2,
  xp,
  goalXp: 20,
  allAvailableDone: false,
  goalMet: met,
});
const stats = (currentStreak: number) => ({
  totalXp: 100,
  currentStreak,
  longestStreak: currentStreak,
  lastGoalDay: null,
  cardCount: 0,
  mediaBytes: 0,
});
const dueCard = (id: string, deckId: string) => ({
  id,
  deckId,
  position: 0,
  nodeIndex: 0,
  front: 'f',
  back: 'b',
  tags: [],
  suspended: false,
  fsrs: {
    state: 'review' as const,
    due: '2020-01-01T00:00:00.000Z',
    stability: 1,
    difficulty: 5,
    learningSteps: 0,
    reps: 2,
    lapses: 0,
    lastReview: '2019-12-01T00:00:00.000Z',
  },
  updatedAt: 'x',
  deletedAt: null,
});

beforeAll(() => void initI18n('en'));
beforeEach(async () => {
  await dexieStore.clearAll();
  await dexieStore.setMeta('userId', 'u');
  await dexieStore.putSettings('u', settings);
});
afterEach(cleanup);

const renderHome = () =>
  render(
    <MemoryRouter>
      <HomePage />
    </MemoryRouter>,
  );

describe('HomePage (FR-025, FR-026)', () => {
  it('shows the streak flame with its count when today is met', async () => {
    await dexieStore.putStats('u', stats(5));
    await dexieStore.putDailyActivity([activity(-1, 20, true), activity(0, 24, true)]);
    renderHome();
    expect(await screen.findByText('5 day streak')).toBeTruthy();
    expect(screen.getByTestId('streak').dataset.status).toBe('met');
    expect(screen.queryByText(/at risk/i)).toBeNull();
  });

  it('marks the streak at risk, with text, when today is not met yet', async () => {
    await dexieStore.putStats('u', stats(3));
    await dexieStore.putDailyActivity([activity(-1, 20, true), activity(0, 4, false)]);
    renderHome();
    expect(await screen.findByText('3 day streak')).toBeTruthy();
    expect(screen.getByTestId('streak').dataset.status).toBe('at_risk');
    expect(screen.getByText(/at risk/i)).toBeTruthy();
  });

  it('shows 0 and no flame state when the streak is broken', async () => {
    await dexieStore.putStats('u', stats(0));
    await dexieStore.putDailyActivity([activity(-3, 20, true)]);
    renderHome();
    expect(await screen.findByText('0 day streak')).toBeTruthy();
    expect(screen.getByTestId('streak').dataset.status).toBe('broken');
  });

  it("shows today's XP against the goal as a progress bar", async () => {
    await dexieStore.putStats('u', stats(0));
    await dexieStore.putDailyActivity([activity(0, 10, false)]);
    renderHome();
    const bar = await screen.findByRole('progressbar', { name: /daily goal/i });
    expect(bar.getAttribute('aria-valuenow')).toBe('10');
    expect(bar.getAttribute('aria-valuemax')).toBe('20');
    expect(screen.getByText('10 / 20 XP')).toBeTruthy();
  });

  it('shows the number of cards due and a Start link to the first deck with due cards', async () => {
    await dexieStore.putDecks([
      {
        id: 'd1',
        name: 'Empty',
        newCardsPerDay: 0,
        createdAt: 'x',
        updatedAt: 'x',
        deletedAt: null,
      },
      {
        id: 'd2',
        name: 'Spanish',
        newCardsPerDay: 0,
        createdAt: 'x',
        updatedAt: 'x',
        deletedAt: null,
      },
    ]);
    await dexieStore.putCards([dueCard('a', 'd2'), dueCard('b', 'd2'), dueCard('c', 'd2')]);
    renderHome();
    expect(await screen.findByText('3 cards due')).toBeTruthy();
    const start = screen.getByRole('link', { name: 'Start' });
    expect(start.getAttribute('href')).toBe('/session/d2');
    await waitFor(() => expect(screen.getByRole('link', { name: /Spanish/ })).toBeTruthy());
  });

  it('with nothing due, says so and offers no Start', async () => {
    renderHome();
    expect(await screen.findByText(/nothing due/i)).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Start' })).toBeNull();
  });
});

describe('Celebration', () => {
  it('announces the goal and the streak increase', () => {
    render(<Celebration goalMet streak={4} streakIncreased onDone={() => {}} motion="reduced" />);
    const status = screen.getByRole('status');
    expect(status.textContent).toMatch(/goal/i);
    expect(status.textContent).toMatch(/4/);
  });

  it('renders nothing when there is nothing to celebrate', () => {
    const { container } = render(
      <Celebration
        goalMet={false}
        streak={0}
        streakIncreased={false}
        onDone={() => {}}
        motion="full"
      />,
    );
    expect(container.textContent).toBe('');
  });
});
