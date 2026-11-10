import { describe, expect, it } from 'vitest';
import { compareTyped, type DiffOp } from '../src/index.js';

const opts = { ignoreCase: true, ignoreDiacritics: false };
const v = (e: string, g: string, o = opts) => compareTyped(e, g, o).verdict;

describe('compareTyped normalization', () => {
  it('trims and collapses whitespace', () => {
    expect(v('hello world', '  hello \t  world\n')).toBe('correct');
  });
  it('treats NFC and NFD as equal', () => {
    expect(v('café', 'café')).toBe('correct');
  });
  it('ignoreCase on/off', () => {
    expect(v('Paris', 'paris')).toBe('correct');
    expect(v('Paris', 'paris', { ignoreCase: false, ignoreDiacritics: false })).not.toBe('correct');
  });
  it('ignoreDiacritics maps Viet Nam and d-stroke', () => {
    const o = { ignoreCase: true, ignoreDiacritics: true };
    expect(v('Việt Nam', 'viet nam', o)).toBe('correct');
    expect(v('đường', 'duong', o)).toBe('correct');
    expect(v('Đà Nẵng', 'da nang', o)).toBe('correct');
    expect(v('Việt Nam', 'viet nam')).not.toBe('correct');
  });
  it('strips html from the expected answer', () => {
    expect(v('<b>a</b> &amp; b', 'a & b')).toBe('correct');
  });
});

describe('compareTyped verdict', () => {
  it('empty input is wrong', () => {
    expect(v('cat', '')).toBe('wrong');
    expect(v('cat', '   ')).toBe('wrong');
  });
  it('answers under 5 characters are only correct or wrong', () => {
    expect(v('cat', 'cut')).toBe('wrong');
    expect(v('four', 'fou')).toBe('wrong');
  });
  it('5 to 11 characters allow exactly one edit', () => {
    expect(v('elephant', 'elephnt')).toBe('almost');
    expect(v('elephant', 'elephants')).toBe('almost');
    expect(v('elephant', 'elepXant')).toBe('almost');
    expect(v('elephant', 'elephnat')).toBe('wrong');
    expect(v('hello', 'hell')).toBe('almost');
    expect(v('12345678901', '1234567890')).toBe('almost');
  });
  it('12 or more characters allow two edits', () => {
    expect(v('international', 'internatioal')).toBe('almost');
    expect(v('international', 'intrnatonal')).toBe('almost');
    expect(v('international', 'intrnatnal')).toBe('wrong');
  });
  it('counts graphemes, not code units', () => {
    expect(v('😀😀😀😀😀', '😀😀😀😀')).toBe('almost');
    expect(v('😀😀😀😀😀', '😀😀😀😀x')).toBe('almost');
    expect(v('aéioux', 'aeiou')).toBe('wrong');
  });
});

const text = (ops: DiffOp[]) => ops.map((o) => `${o.op}:${o.text}${o.op === 'wrong' ? '>' + o.expected : ''}`);

describe('compareTyped diff ops', () => {
  it('equal answer is one equal run', () => {
    expect(compareTyped('abc', 'abc', opts).ops).toEqual([{ op: 'equal', text: 'abc' }]);
  });
  it('marks a missing letter', () => {
    expect(text(compareTyped('elephant', 'elephnt', opts).ops)).toEqual([
      'equal:eleph',
      'missing:a',
      'equal:nt',
    ]);
  });
  it('marks an extra letter', () => {
    expect(text(compareTyped('cat', 'cats', opts).ops)).toEqual(['equal:cat', 'extra:s']);
  });
  it('marks a wrong letter with the expected one', () => {
    expect(text(compareTyped('cat', 'cut', opts).ops)).toEqual(['equal:c', 'wrong:u>a', 'equal:t']);
  });
  it('shows the typed text in its own case, equal under ignoreCase', () => {
    expect(compareTyped('Paris', 'pARIS', opts).ops).toEqual([{ op: 'equal', text: 'pARIS' }]);
  });
  it('everything different is one wrong run', () => {
    expect(text(compareTyped('abc', 'xyz', opts).ops)).toEqual(['wrong:xyz>abc']);
  });
  it('empty given is one missing run', () => {
    expect(text(compareTyped('abc', '', opts).ops)).toEqual(['missing:abc']);
  });
  it('keeps emoji whole', () => {
    expect(text(compareTyped('a😀b', 'ab', opts).ops)).toEqual(['equal:a', 'missing:😀', 'equal:b']);
  });
  it('concatenating equal+wrong+extra gives the typed text, equal+wrong(expected)+missing the expected', () => {
    const { ops } = compareTyped('kitten sat', 'sitting sit', opts);
    const given = ops.map((o) => (o.op === 'missing' ? '' : o.text)).join('');
    const exp = ops
      .map((o) => (o.op === 'wrong' ? o.expected : o.op === 'extra' ? '' : o.text))
      .join('');
    expect(given).toBe('sitting sit');
    expect(exp).toBe('kitten sat');
  });
});
