import { describe, expect, it } from 'vitest';
import { DEFAULT_NOTE_TYPES, renderCard, stripReservedAttrs } from '../src/index.js';

const basic = DEFAULT_NOTE_TYPES[0]!.def;
const render = (fields: Record<string, string>, def = basic) =>
  renderCard(def, fields, null, { templateId: 't_card1', ordinal: 0 });

describe('stripReservedAttrs', () => {
  it('removes ids starting with ad- and keeps other ids', () => {
    expect(stripReservedAttrs('<span id="ad-slot-0">x</span>')).toBe('<span>x</span>');
    expect(stripReservedAttrs('<span id="keep">x</span>')).toBe('<span id="keep">x</span>');
    expect(stripReservedAttrs('<hr id=answer>')).toBe('<hr id=answer>');
  });
  it('removes class tokens starting with ad- and keeps the rest', () => {
    expect(stripReservedAttrs('<span class="ad-slot big">x</span>')).toBe(
      '<span class="big">x</span>',
    );
    expect(stripReservedAttrs('<span class="ad-hint">x</span>')).toBe('<span>x</span>');
    expect(stripReservedAttrs('<p class="a b">x</p>')).toBe('<p class="a b">x</p>');
  });
  it('is case-insensitive and sees through entity encoding', () => {
    expect(stripReservedAttrs('<span ID="AD-slot-0">x</span>')).not.toMatch(/slot/i);
    expect(stripReservedAttrs('<span id="&#97;d-slot-0">x</span>')).not.toMatch(/slot/i);
    expect(stripReservedAttrs('<span class="&#x61;d-slot">x</span>')).not.toMatch(/slot/i);
    expect(stripReservedAttrs("<span id='ad-x'>x</span>")).toBe('<span>x</span>');
  });
  it('leaves text and template tags alone', () => {
    const s = 'a {{Front}} b <b>{{#X}}y{{/X}}</b> id="ad-text"';
    expect(stripReservedAttrs(s)).toBe(s);
  });
  it('does not rebalance unclosed html', () => {
    expect(stripReservedAttrs('<div><span id="ad-x">')).toBe('<div><span>');
  });
});

describe('reserved names in renderCard', () => {
  it('an author-written slot in a field never survives', () => {
    const r = render({ f_front: '<span class="ad-slot" id="ad-slot-0"></span>Q', f_back: 'A' });
    expect(r.front).not.toContain('ad-slot');
    expect(r.back).not.toContain('ad-slot');
    expect(r.front).toContain('Q');
  });
  it('an author-written slot in a template never survives', () => {
    const def = {
      ...basic,
      templates: [
        {
          id: 't_card1',
          name: 'C',
          front: '<span class="ad-slot x" id="ad-slot-0"></span>{{Front}}',
          back: '<i id="ad-hint">{{Back}}</i>',
        },
      ],
    };
    const r = render({ f_front: 'Q', f_back: 'A' }, def);
    expect(r.front).toBe('<span class="x"></span>Q');
    expect(r.back).toBe('<i>A</i>');
  });
});
