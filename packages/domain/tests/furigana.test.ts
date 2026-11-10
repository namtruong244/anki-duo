import { describe, expect, it } from 'vitest';
import {
  furigana,
  kana,
  kanji,
  renderCard,
  validateNoteType,
  type NoteTypeDef,
} from '../src/index.js';

describe('furigana transforms', () => {
  it('furigana wraps base and reading in ruby', () => {
    expect(furigana(' 日本[にほん]語')).toBe('<ruby>日本<rt>にほん</rt></ruby>語');
  });
  it('kana gives the readings only, kanji the bases only', () => {
    expect(kana(' 日本[にほん]語')).toBe('にほん語');
    expect(kanji(' 日本[にほん]語')).toBe('日本語');
  });
  it('base starts after a space or at the start of a segment', () => {
    expect(furigana('私は 日本語[にほんご]を 勉強[べんきょう]します')).toBe(
      '私は<ruby>日本語<rt>にほんご</rt></ruby>を<ruby>勉強<rt>べんきょう</rt></ruby>します',
    );
    expect(kanji('私は 日本語[にほんご]を 勉強[べんきょう]します')).toBe('私は日本語を勉強します');
    expect(furigana('日本語[にほんご]')).toBe('<ruby>日本語<rt>にほんご</rt></ruby>');
  });
  it('treats each text node as a segment and leaves tags intact', () => {
    expect(furigana('<b>日本[にほん]</b>語<i>人[じん]</i>')).toBe(
      '<b><ruby>日本<rt>にほん</rt></ruby></b>語<i><ruby>人<rt>じん</rt></ruby></i>',
    );
    expect(kana('<a href="https://x.test/a[b]">日本[にほん]</a>')).toBe(
      '<a href="https://x.test/a[b]">にほん</a>',
    );
  });
  it('leaves [sound:...] and unmatched brackets alone', () => {
    expect(furigana('a [sound:x.mp3] b')).toBe('a [sound:x.mp3] b');
    expect(furigana('日本[にほん')).toBe('日本[にほん');
    expect(furigana('plain text')).toBe('plain text');
  });
  it('keeps text escaped and drops unsafe markup', () => {
    expect(furigana('a&amp;b[c]')).toBe('<ruby>a&amp;b<rt>c</rt></ruby>');
    expect(furigana('<script>x</script>日[ひ]')).toBe('<ruby>日<rt>ひ</rt></ruby>');
    expect(furigana('日[<img src=x onerror=1>]')).not.toContain('<img');
  });
});

describe('furigana filters through renderCard', () => {
  const d = (front: string): NoteTypeDef => ({
    fields: [{ id: 'a', name: 'A' }],
    templates: [{ id: 't', name: 'T', front, back: '' }],
    css: '',
  });
  const f = { a: ' 日本[にほん]語' };
  const r = (tpl: string) => renderCard(d(tpl), f, null, { templateId: 't', ordinal: 0 }).front;
  it('works for furigana, kana and kanji', () => {
    expect(validateNoteType(d('{{furigana:A}}{{kana:A}}{{kanji:A}}'))).toEqual([]);
    expect(r('{{furigana:A}}')).toBe('<ruby>日本<rt>にほん</rt></ruby>語');
    expect(r('{{kana:A}}')).toBe('にほん語');
    expect(r('{{kanji:A}}')).toBe('日本語');
  });
  it('chains with text', () => {
    expect(r('{{text:kana:A}}')).toBe('にほん語');
  });
});
