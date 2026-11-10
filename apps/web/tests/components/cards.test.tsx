import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { initI18n } from '../../src/i18n';
import { dexieStore } from '../../src/client/store';
import { CardListPage } from '../../src/routes/cards/CardListPage';
import { CardEditorPage } from '../../src/routes/cards/CardEditorPage';
import { ImportPage } from '../../src/routes/import/ImportPage';

const deck = (id: string, name: string) => ({
  id,
  name,
  newCardsPerDay: 20,
  createdAt: '2020-01-01T00:00:00.000Z',
  updatedAt: '2020-01-01T00:00:00.000Z',
  deletedAt: null,
});
const card = (
  id: string,
  deckId: string,
  front: string,
  back: string,
  tags: string[],
  state: 'new' | 'review' = 'new',
  due = '2020-01-01T00:00:00.000Z',
) => ({
  id,
  deckId,
  position: 0,
  nodeIndex: 0,
  front,
  back,
  tags,
  suspended: false,
  noteId: null,
  noteTypeId: null,
  templateId: null,
  format: 'markdown' as const,
  fsrs: {
    state,
    due,
    stability: 1,
    difficulty: 5,
    learningSteps: 0,
    reps: 0,
    lapses: 0,
    lastReview: state === 'new' ? null : '2019-12-01T00:00:00.000Z',
  },
  updatedAt: 'x',
  deletedAt: null,
});

beforeAll(async () => {
  await initI18n('en');
});
beforeEach(async () => {
  await dexieStore.clearAll();
});
afterEach(cleanup);

const renderList = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/cards" element={<CardListPage />} />
        <Route path="/decks/:deckId/cards" element={<CardListPage />} />
        <Route path="/decks/:deckId/cards/new" element={<p>new card page</p>} />
        <Route path="/decks/:deckId/cards/:cardId" element={<p>editor page</p>} />
      </Routes>
    </MemoryRouter>,
  );

describe('Card library', () => {
  const seed = async () => {
    await dexieStore.putDecks([deck('d1', 'IELTS'), deck('d2', 'Kanji')]);
    await dexieStore.putCards([
      card('a', 'd1', '**ubiquitous**', 'everywhere', ['ielts'], 'review'),
      card('b', 'd1', 'mitigate', 'reduce', ['ielts']),
      card('c', 'd2', 'cat', 'neko', ['kanji'], 'review', '2999-01-01T00:00:00.000Z'),
    ]);
  };

  it('shows all cards across decks with status badges, strips markdown', async () => {
    await seed();
    renderList('/cards');
    expect(await screen.findByText('ubiquitous')).toBeTruthy();
    expect(screen.getByText('mitigate')).toBeTruthy();
    expect(screen.getByText('cat')).toBeTruthy();
    expect(screen.getByText('Due')).toBeTruthy();
    expect(screen.getByText('New')).toBeTruthy();
    expect(screen.getByText(/^\d+D$/)).toBeTruthy();
  });

  it('searches front, back and tags', async () => {
    await seed();
    renderList('/cards');
    await screen.findByText('mitigate');
    const search = screen.getByRole('searchbox');
    fireEvent.change(search, { target: { value: 'neko' } });
    expect(screen.queryByText('mitigate')).toBeNull();
    expect(screen.getByText('cat')).toBeTruthy();
    fireEvent.change(search, { target: { value: '#ielts' } });
    expect(screen.getByText('mitigate')).toBeTruthy();
    expect(screen.queryByText('cat')).toBeNull();
  });

  it('filters by tag chip', async () => {
    await seed();
    renderList('/cards');
    await screen.findByText('mitigate');
    fireEvent.click(screen.getByRole('button', { name: '#kanji' }));
    expect(screen.queryByText('mitigate')).toBeNull();
    expect(screen.getByText('cat')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'All' }));
    expect(screen.getByText('mitigate')).toBeTruthy();
  });

  it('limits to one deck when a deck id is in the route; add card targets it', async () => {
    await seed();
    renderList('/decks/d2/cards');
    expect(await screen.findByText('cat')).toBeTruthy();
    expect(screen.queryByText('mitigate')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Add card/ }));
    expect(await screen.findByText('new card page')).toBeTruthy();
  });

  it('opens the editor from a row and offers row actions', async () => {
    await seed();
    renderList('/cards');
    const row = (await screen.findByText('mitigate')).closest('li')!;
    fireEvent.click(within(row).getByRole('button', { name: 'Card actions' }));
    expect(screen.getByRole('menuitem', { name: 'Suspend' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Delete' })).toBeTruthy();
    fireEvent.click(within(row).getByRole('link'));
    expect(await screen.findByText('editor page')).toBeTruthy();
  });

  it('with no decks, links to the home page to create one', async () => {
    renderList('/cards');
    expect(await screen.findByText(/no decks yet/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Add card/ })).toBeNull();
  });
});

describe('Card editor', () => {
  const renderEditor = (path: string) =>
    render(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/decks/:deckId/cards/new" element={<CardEditorPage />} />
          <Route path="/decks/:deckId/cards/:cardId" element={<CardEditorPage />} />
        </Routes>
      </MemoryRouter>,
    );

  // New cards use the note editor (tests/components/note-editor.test.tsx); the Markdown editor
  // is kept for existing legacy cards.
  it('toolbar wraps the selection in markdown and the preview follows', async () => {
    await dexieStore.putDecks([deck('d1', 'IELTS')]);
    await dexieStore.putCards([card('a', 'd1', 'front', 'back', [])]);
    renderEditor('/decks/d1/cards/a');
    const front = (await screen.findByLabelText('Front (Markdown)')) as HTMLTextAreaElement;
    await waitFor(() => expect(front.value).toBe('front'));
    fireEvent.change(front, { target: { value: 'hello' } });
    front.focus();
    front.setSelectionRange(0, 5);
    fireEvent.click(screen.getByRole('button', { name: 'Bold' }));
    expect(front.value).toBe('**hello**');
    expect(screen.getByLabelText('Live preview').querySelector('strong')?.textContent).toBe(
      'hello',
    );
  });

  it('deck is locked when editing a legacy markdown card', async () => {
    await dexieStore.putDecks([deck('d1', 'IELTS')]);
    await dexieStore.putCards([card('a', 'd1', 'front', 'back', ['x'])]);
    renderEditor('/decks/d1/cards/a');
    await waitFor(() =>
      expect((screen.getByLabelText('Front (Markdown)') as HTMLTextAreaElement).value).toBe(
        'front',
      ),
    );
    expect((screen.getByLabelText('Deck') as HTMLSelectElement).disabled).toBe(true);
    expect((screen.getByLabelText('Tags') as HTMLInputElement).value).toBe('#x');
  });
});

describe('Import page', () => {
  it('walks choose file -> map columns -> preview', async () => {
    await dexieStore.putDecks([deck('d1', 'IELTS')]);
    render(
      <MemoryRouter initialEntries={['/decks/d1/import']}>
        <Routes>
          <Route path="/decks/:deckId/import" element={<ImportPage />} />
        </Routes>
      </MemoryRouter>,
    );
    const continueBtn = await screen.findByRole('button', { name: 'Continue' });
    expect((continueBtn as HTMLButtonElement).disabled).toBe(true);
    const csv = new File(['front,back\nhello,xin chao\nbye,tam biet\n'], 'w.csv', {
      type: 'text/csv',
    });
    fireEvent.change(screen.getByTestId('import-file'), { target: { files: [csv] } });
    await waitFor(() =>
      expect((screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement).disabled).toBe(
        false,
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByText('Map file columns to card fields')).toBeTruthy();
    expect((screen.getByLabelText(/Column A/) as HTMLSelectElement).value).toBe('front');
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByText(/2 cards will be imported/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Import 2 cards' })).toBeTruthy();
  });
});
