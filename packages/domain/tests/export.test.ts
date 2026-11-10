import { describe, expect, it } from 'vitest';
import {
  EXPORT_VERSION,
  ExportInvalidError,
  parseExport,
  verifyExport,
} from '../src/export/schema.js';

describe('export schema', () => {
  it('rejects a wrong format or version before anything else', () => {
    expect(() => parseExport({ format: 'x', version: 1 })).toThrow(ExportInvalidError);
    expect(() => parseExport({ format: 'anki-duo-export', version: 3 })).toThrow(/version/);
    expect(() => parseExport({ format: 'anki-duo-export', version: 0 })).toThrow(/version/);
    expect(() => parseExport(null)).toThrow(ExportInvalidError);
  });
  it('verifies an empty deck', () => {
    const doc = parseExport({
      format: 'anki-duo-export',
      version: 1,
      exportedAt: '2026-01-01T00:00:00Z',
      scheduler: {
        algorithm: 'fsrs-6',
        implementation: 'x',
        desiredRetention: 0.9,
        maximumIntervalDays: 36500,
        parameters: [],
      },
      deck: { id: 'd', name: 'n', newCardsPerDay: 20, createdAt: '2026-01-01T00:00:00Z' },
      cards: [],
      reviews: [],
    });
    expect(() => verifyExport(doc)).not.toThrow();
  });

  describe('v1 and v2', () => {
    const fsrs = {
      state: 'new',
      due: '2026-01-01T00:00:00Z',
      stability: 0,
      difficulty: 0,
      learningSteps: 0,
      reps: 0,
      lapses: 0,
      lastReview: null,
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    type Loose = any;
    const base = (version: number): Loose => ({
      format: 'anki-duo-export',
      version,
      exportedAt: '2026-01-01T00:00:00Z',
      scheduler: {
        algorithm: 'fsrs-6',
        implementation: 'x',
        desiredRetention: 0.9,
        maximumIntervalDays: 36500,
        parameters: [],
      },
      deck: { id: 'd', name: 'n', newCardsPerDay: 20, createdAt: '2026-01-01T00:00:00Z' },
      noteTypes: [
        {
          id: 'nt',
          name: 'Basic',
          css: '',
          fields: [{ id: 'f', name: 'Front' }],
          templates: [{ id: 't', name: 'C', front: '{{Front}}', back: '' }],
        },
      ],
      notes: [
        {
          id: 'n1',
          noteTypeId: 'nt',
          fields: { f: 'x' },
          tags: [],
          createdAt: '2026-01-01T00:00:00Z',
        },
      ],
      cards: [
        {
          id: 'c1',
          position: 0,
          nodeIndex: 0,
          front: 'x',
          back: '',
          tags: [],
          suspended: false,
          createdAt: '2026-01-01T00:00:00Z',
          fsrs,
          media: [],
          noteId: 'n1',
          noteTypeId: 'nt',
          templateId: 't',
        },
      ],
      reviews: [],
    });
    const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

    it('fills the v2 defaults for a v1 file', () => {
      const doc = parseExport(base(1));
      expect(doc.version).toBe(1);
      expect(doc.deck.mcPractice).toBe(false);
      expect(doc.noteTypes![0]).toMatchObject({ kind: 'standard', options: {}, builtinKey: null });
      expect(doc.notes![0]!.extra).toBeNull();
      expect(doc.cards[0]).toMatchObject({ ordinal: 0, answerText: '' });
      expect(() => verifyExport(doc)).not.toThrow();
    });
    it('accepts a v2 file and keeps its values', () => {
      const d = base(2);
      d.deck.mcPractice = true;
      d.noteTypes[0].kind = 'cloze';
      d.noteTypes[0].options = { typeIgnoreCase: false };
      d.noteTypes[0].builtinKey = 'cloze';
      d.notes[0].extra = {
        occlusion: {
          mode: 'hide_all',
          masks: [{ n: 1, shape: 'rect', x: 0.1, y: 0.2, w: 0.3, h: 0.1, label: 'N' }],
        },
      };
      d.cards[0].ordinal = 2;
      d.cards[0].answerText = 'cells';
      d.cards[0].interaction = { v: 1, slots: [], answer: null };
      const doc = parseExport(d);
      expect(doc.version).toBe(2);
      expect(doc.deck.mcPractice).toBe(true);
      expect(doc.noteTypes![0]).toMatchObject({ kind: 'cloze', builtinKey: 'cloze' });
      expect(doc.cards[0]).toMatchObject({ ordinal: 2, answerText: 'cells' });
    });
    it('EXPORT_VERSION is 2', () => {
      expect(EXPORT_VERSION).toBe(2);
    });
    it.each([
      ['kind', (d: Loose) => (d.noteTypes[0].kind = 'nope')],
      ['ordinal', (d: Loose) => (d.cards[0].ordinal = -1)],
      ['ordinal int', (d: Loose) => (d.cards[0].ordinal = 1.5)],
      ['mcPractice', (d: Loose) => (d.deck.mcPractice = 'yes')],
      [
        'mask range',
        (d: Loose) =>
          (d.notes[0].extra = {
            occlusion: {
              mode: 'hide_all',
              masks: [{ n: 1, shape: 'rect', x: 1.2, y: 0, w: 0.1, h: 0.1 }],
            },
          }),
      ],
      [
        'mask n unique',
        (d: Loose) =>
          (d.notes[0].extra = {
            occlusion: {
              mode: 'hide_one',
              masks: [1, 1].map(() => ({ n: 1, shape: 'rect', x: 0, y: 0, w: 0.1, h: 0.1 })),
            },
          }),
      ],
      ['extra shape', (d: Loose) => (d.notes[0].extra = 'x')],
    ])('rejects an invalid %s', (_n, mutate) => {
      const d = clone(base(2));
      mutate(d);
      expect(() => parseExport(d)).toThrow(ExportInvalidError);
    });
  });
});
