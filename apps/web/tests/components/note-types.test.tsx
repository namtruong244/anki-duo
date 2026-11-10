import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { initI18n } from '../../src/i18n';
import { ApiError } from '../../src/client/api';

const mocks = vi.hoisted(() => ({
  listNoteTypes: vi.fn(),
  createNoteType: vi.fn(),
  updateNoteType: vi.fn(),
  deleteNoteType: vi.fn(),
}));
vi.mock('../../src/client/runtime', () => ({ content: mocks, newId: () => 'id' }));

import { NoteTypesPage } from '../../src/routes/note-types/NoteTypesPage';
import { NoteTypeEditorPage } from '../../src/routes/note-types/NoteTypeEditorPage';

const basic = {
  id: 'nt-basic',
  name: 'Basic',
  fields: [
    { id: 'f1', name: 'Front' },
    { id: 'f2', name: 'Back' },
  ],
  templates: [{ id: 't1', name: 'Card 1', front: '{{Front}}', back: '{{FrontSide}}<hr>{{Back}}' }],
  css: '.card{color:red}',
  updatedAt: 'x',
  deletedAt: null,
};

beforeAll(async () => {
  await initI18n('en');
});
beforeEach(() => {
  vi.clearAllMocks();
  mocks.listNoteTypes.mockResolvedValue([basic]);
});
afterEach(cleanup);

const app = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/note-types" element={<NoteTypesPage />} />
        <Route path="/note-types/:noteTypeId" element={<NoteTypeEditorPage />} />
      </Routes>
    </MemoryRouter>,
  );

describe('NoteTypesPage', () => {
  it('lists note types', async () => {
    app('/note-types');
    expect(await screen.findByText('Basic')).toBeTruthy();
    expect(screen.getByText('2 fields, 1 card templates')).toBeTruthy();
  });

  it('clones a type on add and opens its editor', async () => {
    mocks.createNoteType.mockResolvedValue({ ...basic, id: 'new', name: 'Basic copy' });
    app('/note-types');
    await screen.findByText('Basic');
    fireEvent.click(screen.getByRole('button', { name: 'Add note type' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(mocks.createNoteType).toHaveBeenCalled());
    expect(mocks.createNoteType.mock.calls[0]![0]).toMatchObject({
      name: 'Basic copy',
      fields: basic.fields,
      templates: basic.templates,
    });
  });

  it('shows the in-use error when delete is refused', async () => {
    mocks.deleteNoteType.mockRejectedValue(new ApiError(409, 'note_type_in_use', 'x'));
    app('/note-types');
    await screen.findByText('Basic');
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(dialog.querySelectorAll('button')[1]!);
    expect((await screen.findByRole('alert')).textContent).toMatch(/still use/i);
  });
});

describe('NoteTypeEditorPage', () => {
  it('shows fields, templates and a preview with sample values', async () => {
    app('/note-types/nt-basic');
    expect(await screen.findByLabelText('Front template')).toBeTruthy();
    expect((screen.getByLabelText('Front template') as HTMLTextAreaElement).value).toBe(
      '{{Front}}',
    );
    expect(screen.getByLabelText('Field 1 name')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows validation errors inline and blocks save', async () => {
    app('/note-types/nt-basic');
    const tpl = await screen.findByLabelText('Front template');
    fireEvent.change(tpl, { target: { value: '{{Nope}}' } });
    expect(
      (await screen.findByRole('alert', { name: 'Problems with this note type' })).textContent,
    ).toMatch(/Nope/);
    expect((screen.getByRole('button', { name: 'Save card' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it('renaming a field updates templates and saves via updateNoteType', async () => {
    mocks.updateNoteType.mockResolvedValue(basic);
    app('/note-types/nt-basic');
    fireEvent.change(await screen.findByLabelText('Field 1 name'), {
      target: { value: 'Question' },
    });
    expect((screen.getByLabelText('Front template') as HTMLTextAreaElement).value).toBe(
      '{{Question}}',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save card' }));
    await waitFor(() => expect(mocks.updateNoteType).toHaveBeenCalled());
    const [id, body] = mocks.updateNoteType.mock.calls[0]!;
    expect(id).toBe('nt-basic');
    expect(body.fields[0]).toEqual({ id: 'f1', name: 'Question' });
    expect(body.templates[0].front).toBe('{{Question}}');
  });

  it('confirms before deleting a template and warns about its cards', async () => {
    mocks.listNoteTypes.mockResolvedValue([
      {
        ...basic,
        templates: [
          ...basic.templates,
          { id: 't2', name: 'Card 2', front: '{{Back}}', back: '{{Front}}' },
        ],
      },
    ]);
    app('/note-types/nt-basic');
    await screen.findByLabelText('Front template');
    fireEvent.click(screen.getByRole('button', { name: 'Delete template' }));
    expect((await screen.findByRole('dialog')).textContent).toMatch(/will be deleted/);
  });
});
