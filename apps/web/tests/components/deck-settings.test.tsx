import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { initI18n } from '../../src/i18n';

const content = vi.hoisted(() => ({
  createDeck: vi.fn(),
  updateDeck: vi.fn(),
  deleteDeck: vi.fn(),
  exportDeck: vi.fn(),
}));
vi.mock('../../src/client/runtime', () => ({ content }));

import { DeckSettingsDialog } from '../../src/routes/decks/DeckSettingsDialog';

const deck = {
  id: 'd1',
  name: 'Spanish',
  newCardsPerDay: 20,
  mcPractice: false,
  createdAt: '',
  updatedAt: '',
  deletedAt: null,
};

beforeAll(() => void initI18n('en'));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('DeckSettingsDialog', () => {
  it('creates a deck', async () => {
    content.createDeck.mockResolvedValue(deck);
    const onClose = vi.fn();
    render(<DeckSettingsDialog open deck={null} cardCount={0} onClose={onClose} />);
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: '  Spanish ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create deck' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(content.createDeck).toHaveBeenCalledWith({ name: 'Spanish', newCardsPerDay: 20 });
  });

  it('validates the name and the daily limit before calling the API', async () => {
    render(<DeckSettingsDialog open deck={null} cardCount={0} onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Create deck' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/1–100/);
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'ok' } });
    fireEvent.change(screen.getByLabelText('New cards per day'), { target: { value: '1000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create deck' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/0 to 999/);
    expect(content.createDeck).not.toHaveBeenCalled();
  });

  it('shows the name-taken error from the API', async () => {
    const { ApiError } = await import('../../src/client/api');
    content.createDeck.mockRejectedValue(new ApiError(409, 'deck_name_taken', 'x'));
    render(<DeckSettingsDialog open deck={null} cardCount={0} onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'dup' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create deck' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/already have a deck/);
  });

  it('asks for a confirmation that names the deck and its card count before deleting', async () => {
    content.deleteDeck.mockResolvedValue(undefined);
    const onClose = vi.fn();
    render(<DeckSettingsDialog open deck={deck} cardCount={12} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete deck' }));
    expect(screen.getByText(/Delete "Spanish" and its 12 cards/)).toBeTruthy();
    expect(content.deleteDeck).not.toHaveBeenCalled();
    fireEvent.click(screen.getAllByRole('button', { name: 'Delete deck' }).at(-1)!);
    await waitFor(() => expect(content.deleteDeck).toHaveBeenCalledWith('d1'));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });
});
