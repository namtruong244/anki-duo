import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useParams } from 'react-router';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
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
  autoGrade: false,
};
const dueCard = (id: string, deckId: string) => ({
  id,
  deckId,
  position: 0,
  nodeIndex: 0,
  front: 'f',
  back: 'b',
  tags: [],
  suspended: false,
  noteId: null,
  noteTypeId: null,
  templateId: null,
  ordinal: 0,
  interaction: null,
  answerText: '',
  format: 'markdown' as const,
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

const deck = (id: string, name: string) => ({
  id,
  name,
  newCardsPerDay: 0,
  mcPractice: false,
  createdAt: 'x',
  updatedAt: 'x',
  deletedAt: null,
});

const SessionProbe = () => <p>session page {useParams().deckId}</p>;

const renderHome = () =>
  render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route index element={<HomePage />} />
        <Route path="/session/:deckId" element={<SessionProbe />} />
        <Route path="/decks/:deckId/import" element={<p>import page</p>} />
        <Route path="/decks/:deckId/cards" element={<p>cards page</p>} />
      </Routes>
    </MemoryRouter>,
  );

describe('Deck hub (HomePage)', () => {
  it('lists decks with due counts and starts a session from the banner', async () => {
    await dexieStore.putDecks([deck('d1', 'Empty'), deck('d2', 'Spanish')]);
    await dexieStore.putCards([dueCard('a', 'd2'), dueCard('b', 'd2'), dueCard('c', 'd2')]);
    renderHome();
    const spanish = await screen.findByRole('listitem', { name: 'Spanish' });
    expect(within(spanish).getByText('3 due · 0 new')).toBeTruthy();
    expect(screen.getByRole('listitem', { name: 'Empty' })).toBeTruthy();
    fireEvent.click(within(spanish).getByRole('button', { name: 'Study now' }));
    expect(await screen.findByText(/session page/)).toBeTruthy();
  });

  it('review-all card shows the total due and opens the combined session over all decks', async () => {
    await dexieStore.putDecks([deck('d1', 'Empty'), deck('d2', 'Spanish')]);
    await dexieStore.putCards([dueCard('a', 'd2'), dueCard('b', 'd2')]);
    renderHome();
    expect(await screen.findByText(/2 cards due · about 1 min/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Review now' }));
    expect(await screen.findByText('session page all')).toBeTruthy();
  });

  it('with nothing due, says so and offers no review button', async () => {
    await dexieStore.putDecks([deck('d1', 'Empty')]);
    renderHome();
    expect(await screen.findByText(/nothing due/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Review now' })).toBeNull();
  });

  it('with no decks, offers to create one and sends Import CSV to the create dialog', async () => {
    renderHome();
    expect(await screen.findByText(/create or import a deck/i)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Import CSV' }));
    expect(await screen.findByRole('dialog')).toBeTruthy();
  });

  it('Import CSV opens the import page of the first deck', async () => {
    await dexieStore.putDecks([deck('d1', 'Spanish')]);
    renderHome();
    await screen.findByRole('listitem', { name: 'Spanish' });
    fireEvent.click(screen.getByRole('button', { name: 'Import CSV' }));
    expect(await screen.findByText('import page')).toBeTruthy();
  });

  it('keeps deck management: create dialog, per-deck cards, import and settings', async () => {
    await dexieStore.putDecks([deck('d1', 'Spanish')]);
    renderHome();
    const item = await screen.findByRole('listitem', { name: 'Spanish' });

    fireEvent.click(within(item).getByRole('button', { name: 'Deck settings' }));
    const dialog = await screen.findByRole('dialog');
    expect((within(dialog).getByLabelText('Name') as HTMLInputElement).value).toBe('Spanish');
    expect(within(dialog).getByRole('button', { name: 'Delete deck' })).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    fireEvent.click(screen.getByRole('button', { name: /Create deck/ }));
    const create = await screen.findByRole('dialog');
    expect((within(create).getByLabelText('Name') as HTMLInputElement).value).toBe('');
    expect(within(create).queryByRole('button', { name: 'Delete deck' })).toBeNull();
    fireEvent.click(within(create).getByRole('button', { name: 'Cancel' }));

    expect(screen.getByTestId('restore-input')).toBeTruthy();
    fireEvent.click(within(item).getByRole('button', { name: 'Cards' }));
    expect(await screen.findByText('cards page')).toBeTruthy();
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
