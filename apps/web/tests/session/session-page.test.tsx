import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { initI18n } from '../../src/i18n';
import { dexieStore } from '../../src/client/store';
import type { Card, Deck, ReviewEvent, Settings } from '../../src/client/local-store';
import { slotWidgets, useAnswer } from '../../src/components/answer';

vi.mock('../../src/client/runtime', () => ({
  newId: (() => {
    let n = 0;
    return () => `00000000-0000-7000-8000-${String(++n).padStart(12, '0')}`;
  })(),
  syncEngine: { syncAfterSession: vi.fn().mockResolvedValue(undefined) },
}));
vi.mock('../../src/client/sound', () => ({
  sound: { play: vi.fn(), playGrade: vi.fn() },
}));

const { SessionPage } = await import('../../src/routes/session/SessionPage');

beforeAll(async () => {
  await initI18n('en');
});

const settings = (autoGrade: boolean): Settings => ({
  locale: 'en',
  timeZone: 'UTC',
  dayStartHour: 0,
  desiredRetention: 0.9,
  maximumIntervalDays: 36500,
  dailyXpGoal: 20,
  sessionSize: 20,
  soundEnabled: false,
  motion: 'reduced',
  autoGrade,
});
const deck: Deck = {
  id: 'd1',
  name: 'Deck',
  newCardsPerDay: 20,
  mcPractice: false,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  deletedAt: null,
};
const card = (n: number, interactive: boolean): Card => ({
  id: `c${n}`,
  deckId: 'd1',
  position: n,
  nodeIndex: 0,
  front: `<p>front ${n}</p><span class="ad-slot" id="ad-slot-0"></span>`,
  back: `<p>back ${n}</p>`,
  tags: [],
  suspended: false,
  noteId: null,
  noteTypeId: null,
  templateId: null,
  ordinal: 0,
  interaction: interactive
    ? {
        v: 1,
        slots: [{ kind: 'type' }],
        answer: { kind: 'type', expected: 'cat', ignoreCase: true, ignoreDiacritics: true },
      }
    : null,
  answerText: '',
  format: 'html',
  fsrs: {
    state: 'review',
    due: '2020-01-01T00:00:00.000Z',
    stability: 5,
    difficulty: 5,
    learningSteps: 0,
    reps: 3,
    lapses: 0,
    lastReview: '2019-12-20T00:00:00.000Z',
  },
  updatedAt: '2026-01-01T00:00:00.000Z',
  deletedAt: null,
});

/** A minimal type-in widget: Enter in the field submits the answer. */
function TestTypeIn() {
  const a = useAnswer();
  return (
    <input
      aria-label="your answer"
      onKeyDown={(e) => {
        if (e.key === 'Enter')
          a.submitAnswer({
            verdict: e.currentTarget.value === 'cat' ? 'correct' : 'wrong',
            given: e.currentTarget.value,
          });
      }}
    />
  );
}

const grab = (): HTMLInputElement => {
  const host = document.querySelector('[style*="contain"]') as HTMLElement;
  return host.shadowRoot!.querySelector('input') as HTMLInputElement;
};

async function open(cards: Card[], autoGrade = false) {
  await dexieStore.clearAll();
  await dexieStore.setMeta('userId', 'u');
  await dexieStore.putSettings('u', settings(autoGrade));
  await dexieStore.putDecks([deck]);
  await dexieStore.putCards(cards);
  render(
    <MemoryRouter initialEntries={['/session/d1']}>
      <Routes>
        <Route path="/session/:deckId" element={<SessionPage />} />
      </Routes>
    </MemoryRouter>,
  );
  await screen.findByRole('group', { hidden: true }).catch(() => undefined);
}

beforeEach(() => {
  slotWidgets.type = TestTypeIn;
});
afterEach(() => {
  cleanup();
  delete slotWidgets.type;
});

describe('SessionPage answering', () => {
  it('hides the reveal button while answering and mounts the widget', async () => {
    await open([card(1, true)]);
    await waitFor(() => expect(grab()).toBeTruthy());
    expect(screen.queryByRole('button', { name: 'Show answer' })).toBeNull();
    expect(screen.queryByRole('group', { name: 'Grade this card' })).toBeNull();
  });

  it('still shows the reveal button for a plain card', async () => {
    await open([card(1, false)]);
    expect(await screen.findByRole('button', { name: /show answer|reveal/i })).toBeTruthy();
  });

  it('shows the Suggested badge after submit, and the Enter that submitted does not confirm', async () => {
    await open([card(1, true)]);
    await waitFor(() => expect(grab()).toBeTruthy());
    const input = grab();
    fireEvent.change(input, { target: { value: 'cat' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await screen.findByRole('group', { name: 'Grade this card' });
    expect(screen.getByText('Suggested')).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Good/ }).getAttribute('data-suggested')).toBe(
      'true',
    );
    await dexieStore.listOutbox();
    expect((await dexieStore.listOutbox()).some((e) => e.type === 'review')).toBe(false);
  });

  it('Enter and Space outside a field confirm the suggestion', async () => {
    await open([card(1, true), card(2, true)]);
    await waitFor(() => expect(grab()).toBeTruthy());
    fireEvent.change(grab(), { target: { value: 'dog' } });
    fireEvent.keyDown(grab(), { key: 'Enter' });
    await screen.findByRole('group', { name: 'Grade this card' });
    fireEvent.keyDown(document.body, { key: 'Enter' });
    await waitFor(async () => {
      const reviews = (await dexieStore.listOutbox()).filter((e) => e.type === 'review');
      expect((reviews as ReviewEvent[]).map((r) => r.grade)).toEqual([1]);
    });
    await waitFor(() =>
      expect(screen.queryByRole('group', { name: 'Grade this card' })).toBeNull(),
    );
    await waitFor(() => expect(grab()).toBeTruthy());
    fireEvent.change(grab(), { target: { value: 'cat' } });
    fireEvent.keyDown(grab(), { key: 'Enter' });
    await screen.findByRole('group', { name: 'Grade this card' });
    fireEvent.keyDown(document.body, { key: ' ' });
    await waitFor(async () => {
      const reviews = (await dexieStore.listOutbox()).filter((e) => e.type === 'review');
      expect((reviews as ReviewEvent[]).map((r) => r.grade)).toEqual([1, 3]);
    });
  });

  it('keys typed in a field never grade, even inside a shadow root', async () => {
    await open([card(1, true)]);
    await waitFor(() => expect(grab()).toBeTruthy());
    fireEvent.change(grab(), { target: { value: 'cat' } });
    fireEvent.keyDown(grab(), { key: 'Enter' });
    await screen.findByRole('group', { name: 'Grade this card' });
    const plain = document.body.appendChild(document.createElement('input'));
    const host = document.body.appendChild(document.createElement('div'));
    const inner = host.attachShadow({ mode: 'open' }).appendChild(document.createElement('input'));
    for (const el of [plain, inner]) {
      for (const key of [' ', '3', 'Enter']) {
        fireEvent.keyDown(el, { key, composed: true });
      }
    }
    expect((await dexieStore.listOutbox()).some((e) => e.type === 'review')).toBe(false);
    plain.remove();
    host.remove();
  });

  it('with auto-grade the back and Continue stay until clicked', async () => {
    await open([card(1, true), card(2, false)], true);
    await waitFor(() => expect(grab()).toBeTruthy());
    fireEvent.change(grab(), { target: { value: 'cat' } });
    fireEvent.keyDown(grab(), { key: 'Enter' });
    const cont = await screen.findByRole('button', { name: 'Continue' });
    expect(screen.queryByRole('group', { name: 'Grade this card' })).toBeNull();
    await waitFor(async () =>
      expect((await dexieStore.listOutbox()).filter((e) => e.type === 'review')).toHaveLength(1),
    );
    expect(screen.getByRole('button', { name: 'Continue' })).toBe(cont);
    fireEvent.click(cont);
    await screen.findByRole('button', { name: /show answer|reveal/i });
    expect(screen.queryByRole('button', { name: 'Continue' })).toBeNull();
  });
});
