import { describe, expect, it } from 'vitest';
import { ExportInvalidError, parseExport, verifyExport } from '../src/export/schema.js';

describe('export schema', () => {
  it('rejects a wrong format or version before anything else', () => {
    expect(() => parseExport({ format: 'x', version: 1 })).toThrow(ExportInvalidError);
    expect(() => parseExport({ format: 'anki-duo-export', version: 2 })).toThrow(/version/);
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
});
