import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import i18next from 'i18next';
import { dexieStore } from '../../src/client/store';
import type { Settings } from '../../src/client/local-store';
import { studyWindow } from '../../src/client/session/session-machine';
import { initI18n } from '../../src/i18n';
import { DashboardPage } from '../../src/routes/dashboard/DashboardPage';

const now = '2026-03-10T10:00:00.000Z';
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

function card(id: string, deckId: string, state: string, suspended = false) {
  return {
    id,
    deckId,
    front: 'f',
    back: 'b',
    tags: [],
    suspended,
    fsrs: { state, due: '2999-01-01T00:00:00.000Z' },
    updatedAt: now,
  };
}

beforeEach(async () => {
  initI18n('en');
  await i18next.changeLanguage('en');
  await dexieStore.clearAll();
  await dexieStore.setMeta('userId', 'u');
  await dexieStore.putSettings('u', settings);
  await dexieStore.decks.bulkPut([
    { id: 'd1', name: 'Alpha', newCardsPerDay: 20, updatedAt: now },
    { id: 'd2', name: 'Beta', newCardsPerDay: 20, updatedAt: now },
  ] as never);
  await dexieStore.cards.bulkPut([
    card('c1', 'd1', 'new'),
    card('c2', 'd1', 'new'),
    card('c3', 'd2', 'review'),
  ] as never);
});
afterEach(cleanup);

describe('DashboardPage', () => {
  it('shows the title, record cards, donut and calendar', async () => {
    render(<DashboardPage />);
    expect(await screen.findByRole('heading', { name: 'Stats' })).toBeTruthy();
    expect(screen.getByText('Current streak')).toBeTruthy();
    expect(screen.getByText('Longest streak')).toBeTruthy();
    expect(screen.getByText('Total XP')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Card status breakdown' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: '12-month study calendar' })).toBeTruthy();
    expect(screen.getByTestId('heatmap')).toBeTruthy();
    // Two new cards available today; the review card is not due until 2999.
    expect(screen.getByTestId('donut-centre').textContent).toContain('2');
  });

  it('centre counts due-today cards and caps new cards by the deck daily limit', async () => {
    await dexieStore.decks.update('d1', { newCardsPerDay: 1 } as never);
    await dexieStore.cards.bulkPut([
      { ...card('c4', 'd2', 'review'), fsrs: { state: 'review', due: '2000-01-01T00:00:00.000Z' } },
      {
        ...card('c5', 'd2', 'review', true),
        fsrs: { state: 'review', due: '2000-01-01T00:00:00.000Z' },
      },
    ] as never);
    render(<DashboardPage />);
    // d1: 2 new capped to 1; d2: 1 due (suspended one excluded).
    expect((await screen.findByTestId('donut-centre')).textContent).toContain('2');
    const select = await screen.findByRole('combobox', { name: 'Deck' });
    fireEvent.change(select, { target: { value: 'd2' } });
    expect(screen.getByTestId('donut-centre').textContent).toContain('1');
    fireEvent.change(select, { target: { value: 'd1' } });
    expect(screen.getByTestId('donut-centre').textContent).toContain('1');
  });

  it('filters the donut by deck', async () => {
    render(<DashboardPage />);
    const select = (await screen.findByRole('combobox', { name: 'Deck' })) as HTMLSelectElement;
    expect(select.value).toBe('all');
    expect(screen.getByRole('button', { name: 'All decks' })).toBeTruthy();
    fireEvent.change(select, { target: { value: 'd2' } });
    expect(select.value).toBe('d2');
    expect(screen.getByRole('button', { name: 'Beta' })).toBeTruthy();
    const list = screen.getByRole('list', { name: 'Cards by status' });
    expect(within(list).getByText('Learning').closest('li')!.textContent).toMatch(/0$/);
    expect(screen.getByTestId('donut-centre').textContent).toContain('0');
    fireEvent.change(select, { target: { value: 'd1' } });
    expect(screen.getByTestId('donut-centre').textContent).toContain('2');
  });

  it('counts only days within the 12-month calendar window for daysStudied', async () => {
    const currentStudyDay = studyWindow(new Date(), settings).day;
    const oldDay = '2020-01-01';
    await dexieStore.dailyActivity.bulkPut([
      {
        studyDay: oldDay,
        reviews: 10,
        xp: 100,
        goalXp: 20,
        allAvailableDone: true,
        goalMet: true,
      },
      {
        studyDay: currentStudyDay,
        reviews: 5,
        xp: 50,
        goalXp: 20,
        allAvailableDone: true,
        goalMet: true,
      },
    ]);
    render(<DashboardPage />);
    expect(await screen.findByText('1 days studied')).toBeTruthy();
  });
});
