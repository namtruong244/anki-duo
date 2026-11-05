import { describe, expect, it } from 'vitest';
import {
  normaliseFront,
  splitTags,
  validateRow,
  MAX_FRONT,
  MAX_BACK,
  MAX_TAGS,
  MAX_TAG_LENGTH,
} from '../src/import/rows.js';

describe('normaliseFront', () => {
  it('lower-cases, trims, collapses whitespace and normalises to NFC', () => {
    expect(normaliseFront('  Hello   WORLD\t\n ')).toBe('hello world');
    // "é" as e + combining acute equals the precomposed "é"
    expect(normaliseFront('Café')).toBe(normaliseFront('Café'));
    expect(normaliseFront('Café')).toBe('café');
  });

  it('treats Vietnamese composed and decomposed forms as the same', () => {
    const composed = 'Việt Nam';
    const decomposed = composed.normalize('NFD');
    expect(decomposed).not.toBe(composed);
    expect(normaliseFront(decomposed)).toBe(normaliseFront(composed));
  });

  it('is idempotent', () => {
    const x = normaliseFront('  A  B ');
    expect(normaliseFront(x)).toBe(x);
  });
});

describe('splitTags', () => {
  it('splits on whitespace or semicolons and drops empties', () => {
    expect(splitTags('a b;c ; d')).toEqual(['a', 'b', 'c', 'd']);
    expect(splitTags('  ')).toEqual([]);
    expect(splitTags('')).toEqual([]);
    expect(splitTags('one;;two')).toEqual(['one', 'two']);
  });
});

describe('validateRow', () => {
  const ok = { front: 'hi', back: 'there', tags: ['x'] };

  it('accepts a valid row and trims the front', () => {
    expect(validateRow({ ...ok, front: '  hi ' })).toEqual({
      ok: true,
      value: { front: 'hi', back: 'there', tags: ['x'] },
    });
  });

  it('accepts an empty back and no tags', () => {
    expect(validateRow({ front: 'hi', back: '', tags: [] }).ok).toBe(true);
  });

  it('empty_front when the front is blank after trimming', () => {
    expect(validateRow({ ...ok, front: '   ' })).toEqual({ ok: false, reason: 'empty_front' });
    expect(validateRow({ ...ok, front: '' })).toEqual({ ok: false, reason: 'empty_front' });
  });

  it('front_too_long over 10,000 chars (the limit itself is fine)', () => {
    expect(validateRow({ ...ok, front: 'a'.repeat(MAX_FRONT) }).ok).toBe(true);
    expect(validateRow({ ...ok, front: 'a'.repeat(MAX_FRONT + 1) })).toEqual({
      ok: false,
      reason: 'front_too_long',
    });
  });

  it('back_too_long over 10,000 chars', () => {
    expect(validateRow({ ...ok, back: 'a'.repeat(MAX_BACK) }).ok).toBe(true);
    expect(validateRow({ ...ok, back: 'a'.repeat(MAX_BACK + 1) })).toEqual({
      ok: false,
      reason: 'back_too_long',
    });
  });

  it('counts characters, not UTF-16 units', () => {
    expect(validateRow({ ...ok, front: '😀'.repeat(MAX_FRONT) }).ok).toBe(true);
  });

  it('too_many_tags over 20', () => {
    const tags = (n: number) => Array.from({ length: n }, (_, i) => `t${i}`);
    expect(validateRow({ ...ok, tags: tags(MAX_TAGS) }).ok).toBe(true);
    expect(validateRow({ ...ok, tags: tags(MAX_TAGS + 1) })).toEqual({
      ok: false,
      reason: 'too_many_tags',
    });
  });

  it('tag_invalid for a tag over 50 chars, an empty tag, or one containing whitespace', () => {
    expect(validateRow({ ...ok, tags: ['a'.repeat(MAX_TAG_LENGTH)] }).ok).toBe(true);
    expect(validateRow({ ...ok, tags: ['a'.repeat(MAX_TAG_LENGTH + 1)] })).toEqual({
      ok: false,
      reason: 'tag_invalid',
    });
    expect(validateRow({ ...ok, tags: [''] })).toEqual({ ok: false, reason: 'tag_invalid' });
    expect(validateRow({ ...ok, tags: ['has space'] })).toEqual({
      ok: false,
      reason: 'tag_invalid',
    });
  });

  it('reports the first problem in a fixed order: front, back, tags', () => {
    expect(validateRow({ front: '', back: 'a'.repeat(MAX_BACK + 1), tags: ['has space'] })).toEqual(
      { ok: false, reason: 'empty_front' },
    );
  });
});
