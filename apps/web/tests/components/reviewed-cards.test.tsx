import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ReviewedCardsList, plainText } from '../../src/components/session/ReviewedCardsList';
import type { Card } from '../../src/client/local-store';
import { initI18n } from '../../src/i18n';

afterEach(cleanup);
initI18n('en');

const NOW = new Date('2026-03-01T12:00:00.000Z');
const card = (id: string, front: string, due: string): Card => ({
  id,
  deckId: 'd1',
  position: 0,
  nodeIndex: 0,
  front,
  back: 'b',
  tags: [],
  suspended: false,
  noteId: null,
  noteTypeId: null,
  templateId: null,
  format: 'markdown' as const,
  fsrs: {
    state: 'review',
    due,
    stability: 5,
    difficulty: 5,
    learningSteps: 0,
    reps: 3,
    lapses: 0,
    lastReview: NOW.toISOString(),
  },
  updatedAt: 'x',
  deletedAt: null,
});

describe('ReviewedCardsList', () => {
  it('lists each card with its last grade and next due, linking to the editor', () => {
    const onBack = vi.fn();
    render(
      <MemoryRouter>
        <Routes>
          <Route
            path="/"
            element={
              <ReviewedCardsList
                now={NOW}
                onBack={onBack}
                items={[
                  {
                    card: card('a', '**hola**', '2026-03-04T12:00:00.000Z'),
                    lastGrade: 3,
                    reviews: 1,
                  },
                  {
                    card: card('b', 'adiós', '2026-03-01T12:10:00.000Z'),
                    lastGrade: 1,
                    reviews: 2,
                  },
                ]}
              />
            }
          />
          <Route path="/decks/:d/cards/:c" element={<p>editor</p>} />
        </Routes>
      </MemoryRouter>,
    );
    const rows = screen.getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(within(rows[0]!).getByText('hola')).toBeTruthy();
    expect(within(rows[0]!).getByText('Good')).toBeTruthy();
    expect(within(rows[0]!).getByText('Next: 3d')).toBeTruthy();
    expect(within(rows[1]!).getByText('Again')).toBeTruthy();
    expect(within(rows[1]!).getByText(/Next: 10m/)).toBeTruthy();
    expect(within(rows[1]!).getByText(/2 reviews/)).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button', { name: 'Back to summary' })[0]!);
    expect(onBack).toHaveBeenCalled();
    fireEvent.click(within(rows[0]!).getByRole('link'));
    expect(screen.getByText('editor')).toBeTruthy();
  });

  it('strips markdown and media tokens', () => {
    expect(plainText('# *Hi* [[audio:11111111-1111-1111-1111-111111111111]] ![x](y) [l](u)')).toBe(
      'Hi l',
    );
  });
});
