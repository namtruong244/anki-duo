import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { initI18n } from '../../src/i18n';
import { dexieStore } from '../../src/client/store';
import { ApiError } from '../../src/client/api';

const mocks = vi.hoisted(() => ({
  listNoteTypes: vi.fn(),
  createNote: vi.fn(),
  updateNote: vi.fn(),
  getNote: vi.fn(),
}));
vi.mock('../../src/client/runtime', () => ({
  content: mocks,
  newId: () => 'id',
  syncEngine: { syncNow: async () => undefined },
}));

import { NoteEditor } from '../../src/components/editor/NoteEditor';
import { RichFieldEditor } from '../../src/components/editor/RichFieldEditor';
import { CardEditorPage } from '../../src/routes/cards/CardEditorPage';

const basic = {
  id: 'nt-basic',
  name: 'Basic',
  fields: [
    { id: 'f1', name: 'Front' },
    { id: 'f2', name: 'Back' },
  ],
  templates: [{ id: 't1', name: 'Card 1', front: '{{Front}}', back: '{{FrontSide}}<hr>{{Back}}' }],
  css: '',
  updatedAt: 'x',
  deletedAt: null,
};
const reversed = {
  ...basic,
  id: 'nt-rev',
  name: 'Basic (and reversed card)',
  templates: [
    ...basic.templates,
    { id: 't2', name: 'Card 2', front: '{{Back}}', back: '{{FrontSide}}<hr>{{Front}}' },
  ],
};

beforeAll(async () => {
  await initI18n('en');
});
beforeEach(async () => {
  vi.clearAllMocks();
  localStorage.clear();
  mocks.listNoteTypes.mockResolvedValue([reversed, basic]);
  await dexieStore.clearAll();
});
afterEach(cleanup);

const note = {
  id: 'n1',
  deckId: 'd1',
  noteTypeId: 'nt-basic',
  fields: { f1: 'Hello', f2: 'World' },
  tags: ['x'],
  extra: null,
  cards: [{ id: 'c1', templateId: 't1', ordinal: 0 }],
  updatedAt: 'x',
};

const renderEditor = (ui: React.ReactNode) => render(<MemoryRouter>{ui}</MemoryRouter>);

describe('RichFieldEditor', () => {
  it('renders a labelled editor with a toolbar and toggles to raw HTML', async () => {
    const onChange = vi.fn();
    render(<RichFieldEditor id="x" label="Front" value="<b>hi</b>" onChange={onChange} />);
    expect(screen.getByRole('toolbar')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Bold' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'HTML' }));
    const ta = screen.getByLabelText('HTML source of Front') as HTMLTextAreaElement;
    expect(ta.value).toBe('<b>hi</b>');
    fireEvent.change(ta, { target: { value: '<i>yo</i><script>alert(1)</script>' } });
    fireEvent.blur(ta);
    expect(onChange).toHaveBeenLastCalledWith(expect.not.stringContaining('script'));
  });

  it('disables media buttons until a card exists', () => {
    render(<RichFieldEditor id="x" label="Front" value="" onChange={() => undefined} />);
    expect(
      (screen.getByRole('button', { name: 'Insert image' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});

describe('NoteEditor', () => {
  it('defaults to Basic, lists a field editor per field and saves via createNote', async () => {
    mocks.createNote.mockResolvedValue({
      ...note,
      cards: [{ id: 'c9', templateId: 't1', ordinal: 0 }],
    });
    const onCreated = vi.fn();
    renderEditor(<NoteEditor deckId="d1" onClose={() => undefined} onCreated={onCreated} />);
    await screen.findByRole('textbox', { name: 'Front' });
    expect(screen.getByRole('textbox', { name: 'Back' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Save card' }));
    await waitFor(() => expect(mocks.createNote).toHaveBeenCalled());
    expect(mocks.createNote).toHaveBeenCalledWith('d1', {
      noteTypeId: 'nt-basic',
      fields: { f1: '', f2: '' },
      tags: [],
    });
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    expect(localStorage.getItem('anki-duo.lastNoteType')).toBe('nt-basic');
  });

  it('uses the last used note type and shows a tab per template', async () => {
    localStorage.setItem('anki-duo.lastNoteType', 'nt-rev');
    renderEditor(<NoteEditor deckId="d1" onClose={() => undefined} />);
    await screen.findByRole('tab', { name: 'Card 2' });
    expect(screen.getByRole('tab', { name: 'Card 1' })).toBeTruthy();
  });

  it('maps empty_front to a message', async () => {
    mocks.createNote.mockRejectedValue(new ApiError(422, 'empty_front', 'x'));
    renderEditor(<NoteEditor deckId="d1" onClose={() => undefined} />);
    await screen.findByRole('textbox', { name: 'Front' });
    fireEvent.click(screen.getByRole('button', { name: 'Save card' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/front/i);
  });

  it('edits an existing note with a fixed type and saves via updateNote', async () => {
    mocks.updateNote.mockResolvedValue(note);
    const onClose = vi.fn();
    renderEditor(<NoteEditor deckId="d1" note={note} onClose={onClose} />);
    await screen.findByRole('textbox', { name: 'Front' });
    fireEvent.click(screen.getByRole('button', { name: 'Save card' }));
    await waitFor(() => expect(mocks.updateNote).toHaveBeenCalled());
    expect(mocks.updateNote.mock.calls[0]![0]).toBe('n1');
    expect(mocks.updateNote.mock.calls[0]![1].tags).toEqual(['x']);
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });
});

describe('NoteEditor removal confirmation (FR-003)', () => {
  // The note has two cards but Basic only yields Card 1, so c2 (t2) vanishes on save.
  const twoCards = {
    ...note,
    cards: [
      { id: 'c1', templateId: 't1', ordinal: 0 },
      { id: 'c2', templateId: 't2', ordinal: 0 },
    ],
  };
  const stored = (id: string, reps: number) =>
    ({
      id,
      deckId: 'd1',
      position: 0,
      nodeIndex: 0,
      front: '',
      back: '',
      tags: [],
      suspended: false,
      noteId: 'n1',
      noteTypeId: 'nt-basic',
      templateId: 't2',
      ordinal: 0,
      format: 'html',
      fsrs: {
        state: 'review',
        due: 'x',
        stability: 1,
        difficulty: 1,
        learningSteps: 0,
        reps,
        lapses: 0,
        lastReview: null,
      },
      updatedAt: 'x',
      deletedAt: null,
    }) as never;

  const save = async () => {
    renderEditor(<NoteEditor deckId="d1" note={twoCards} onClose={() => undefined} />);
    await screen.findByRole('textbox', { name: 'Front' });
    fireEvent.click(screen.getByRole('button', { name: 'Save card' }));
  };

  it('asks first when a reviewed card vanishes, then resends with confirmRemoval', async () => {
    await dexieStore.putCards([stored('c2', 3)]);
    mocks.updateNote.mockResolvedValue(note);
    await save();
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toMatch(/1 card and its review history will be removed/);
    expect(mocks.updateNote).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(mocks.updateNote).toHaveBeenCalledTimes(1));
    expect(mocks.updateNote.mock.calls[0]![1].confirmRemoval).toBe(true);
  });

  it('does not ask when only unreviewed cards vanish', async () => {
    await dexieStore.putCards([stored('c2', 0)]);
    mocks.updateNote.mockResolvedValue(note);
    await save();
    await waitFor(() => expect(mocks.updateNote).toHaveBeenCalledTimes(1));
    expect(mocks.updateNote.mock.calls[0]![1].confirmRemoval).toBeUndefined();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('opens the same dialog on a server 409 and resends on confirm', async () => {
    mocks.updateNote
      .mockRejectedValueOnce(
        new ApiError(409, 'cards_would_be_removed', 'x', undefined, undefined, 2),
      )
      .mockResolvedValueOnce(note);
    renderEditor(<NoteEditor deckId="d1" note={note} onClose={() => undefined} />);
    await screen.findByRole('textbox', { name: 'Front' });
    fireEvent.click(screen.getByRole('button', { name: 'Save card' }));
    expect((await screen.findByRole('dialog')).textContent).toMatch(/2 cards and their review/);
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(mocks.updateNote).toHaveBeenCalledTimes(2));
    expect(mocks.updateNote.mock.calls[1]![1].confirmRemoval).toBe(true);
  });
});

describe('CardEditorPage routing', () => {
  const card = (over: object) => ({
    id: 'c1',
    deckId: 'd1',
    position: 0,
    nodeIndex: 0,
    front: 'f',
    back: 'b',
    tags: [],
    suspended: false,
    noteId: null,
    noteTypeId: null,
    templateId: null,
    format: 'markdown',
    fsrs: {
      state: 'new',
      due: '2020-01-01T00:00:00.000Z',
      stability: 0,
      difficulty: 0,
      learningSteps: 0,
      reps: 0,
      lapses: 0,
      lastReview: null,
    },
    updatedAt: 'x',
    deletedAt: null,
    ...over,
  });
  const at = (path: string) =>
    render(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/decks/:deckId/cards/new" element={<CardEditorPage />} />
          <Route path="/decks/:deckId/cards/:cardId" element={<CardEditorPage />} />
        </Routes>
      </MemoryRouter>,
    );

  it('opens the legacy Markdown editor for a markdown card', async () => {
    await dexieStore.putCards([card({}) as never]);
    at('/decks/d1/cards/c1');
    expect(await screen.findByLabelText('Front (Markdown)')).toBeTruthy();
    expect(mocks.getNote).not.toHaveBeenCalled();
  });

  it('opens the note editor for a note card', async () => {
    await dexieStore.putCards([card({ noteId: 'n1', format: 'html' }) as never]);
    mocks.getNote.mockResolvedValue(note);
    at('/decks/d1/cards/c1');
    await screen.findByRole('textbox', { name: 'Front' });
    expect(mocks.getNote).toHaveBeenCalledWith('n1');
  });

  it('uses the note editor for new cards', async () => {
    at('/decks/d1/cards/new');
    expect(await screen.findByText('Add new note')).toBeTruthy();
  });
});
