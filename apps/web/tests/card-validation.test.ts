import { describe, expect, it } from 'vitest';
import { validateCard } from '../src/client/card-validation';

describe('validateCard', () => {
  it('accepts a valid card and splits tags', () => {
    expect(validateCard(' hi ', '', 'a b;c')).toEqual({
      ok: true,
      front: 'hi',
      back: '',
      tags: ['a', 'b', 'c'],
    });
  });
  it('explains each limit', () => {
    expect(validateCard('  ', '', '')).toEqual({ ok: false, error: 'frontRequired' });
    expect(validateCard('a'.repeat(10_001), '', '')).toEqual({ ok: false, error: 'frontTooLong' });
    expect(validateCard('a', 'b'.repeat(10_001), '')).toEqual({ ok: false, error: 'backTooLong' });
    expect(validateCard('a', '', Array.from({ length: 21 }, (_, i) => `t${i}`).join(' '))).toEqual({
      ok: false,
      error: 'tooManyTags',
    });
    expect(validateCard('a', '', 'x'.repeat(51))).toEqual({ ok: false, error: 'tagInvalid' });
  });
});
