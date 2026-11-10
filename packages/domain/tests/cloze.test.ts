import { describe, expect, it } from 'vitest';
import { findClozeProblems, parseCloze } from '../src/index.js';

describe('parseCloze', () => {
  it('parses a simple marker with offsets', () => {
    const html = 'The {{c1::cat}} sat';
    const [m] = parseCloze(html);
    expect(m).toMatchObject({ n: 1, answerHtml: 'cat', start: 4, end: 15, children: [] });
    expect(m!.hint).toBeUndefined();
    expect(html.slice(m!.start, m!.end)).toBe('{{c1::cat}}');
  });
  it('parses a hint', () => {
    const [m] = parseCloze('{{c2::B::the letter}}');
    expect(m).toMatchObject({ n: 2, answerHtml: 'B', hint: 'the letter' });
  });
  it('keeps repeated numbers and skipped numbers', () => {
    const ms = parseCloze('{{c1::a}} {{c3::b}} {{c1::c}}');
    expect(ms.map((m) => m.n)).toEqual([1, 3, 1]);
  });
  it('nests markers', () => {
    const ms = parseCloze('{{c1::capital of {{c2::France}}}}');
    expect(ms).toHaveLength(1);
    expect(ms[0]!.n).toBe(1);
    expect(ms[0]!.answerHtml).toBe('capital of {{c2::France}}');
    expect(ms[0]!.children).toHaveLength(1);
    expect(ms[0]!.children[0]).toMatchObject({ n: 2, answerHtml: 'France' });
  });
  it('keeps html inside the answer', () => {
    const [m] = parseCloze('{{c1::<b>bold</b> and <i>it</i>}}');
    expect(m!.answerHtml).toBe('<b>bold</b> and <i>it</i>');
  });
  it('ignores markers inside tag attributes', () => {
    expect(parseCloze('<a title="{{c1::x}}">link</a>')).toEqual([]);
    expect(parseCloze('<img alt="a>{{c1::x}}" src="y">{{c2::z}}').map((m) => m.n)).toEqual([2]);
  });
  it('leaves malformed markers as literal text', () => {
    expect(parseCloze('{{c1::abc')).toEqual([]);
    expect(parseCloze('{{c0::x}}')).toEqual([]);
    expect(parseCloze('{{cx::x}}')).toEqual([]);
    expect(parseCloze('x }} y')).toEqual([]);
    expect(parseCloze('{{c1::abc {{c2::d}}').map((m) => m.n)).toEqual([2]);
  });
  it('is not exponential on many unterminated openers', () => {
    const t = Date.now();
    parseCloze('{{c1::'.repeat(3000));
    expect(Date.now() - t).toBeLessThan(2000);
  });
});

describe('findClozeProblems', () => {
  it('is empty for valid text', () => {
    expect(findClozeProblems('{{c1::a}} {{c2::b {{c3::c}}}}')).toEqual([]);
    expect(findClozeProblems('plain')).toEqual([]);
  });
  it('reports an unterminated marker', () => {
    const p = findClozeProblems('a {{c1::abc');
    expect(p).toHaveLength(1);
    expect(p[0]).toMatchObject({ kind: 'unterminated', start: 2 });
  });
  it('reports an invalid number once (not also an unmatched close)', () => {
    expect(findClozeProblems('{{c0::x}}').map((p) => p.kind)).toEqual(['invalid_number']);
    expect(findClozeProblems('{{cx::x}}').map((p) => p.kind)).toEqual(['invalid_number']);
  });
  it('reports an unmatched close', () => {
    const p = findClozeProblems('a }} b');
    expect(p.map((x) => x.kind)).toEqual(['unmatched_close']);
    expect(p[0]).toMatchObject({ start: 2, end: 4 });
  });
  it('reports each malformed marker', () => {
    const kinds = findClozeProblems('{{c1::a {{c0::b}} {{c2::ok}} }} {{c3::z').map((p) => p.kind);
    expect(kinds).toContain('invalid_number');
    expect(kinds).toContain('unterminated');
  });
  it('ignores text inside tags', () => {
    expect(findClozeProblems('<a title="{{c0::">x</a>')).toEqual([]);
  });
});
