import { describe, expect, it } from 'vitest';
import { DEFAULT_NOTE_TYPES, listCardSlots, renderCard, validateNoteType } from '../src/index.js';

const [basic, reversed, optional] = DEFAULT_NOTE_TYPES.map((d) => d.def) as [
  (typeof DEFAULT_NOTE_TYPES)[number]['def'],
  (typeof DEFAULT_NOTE_TYPES)[number]['def'],
  (typeof DEFAULT_NOTE_TYPES)[number]['def'],
];

describe('listCardSlots (standard kinds)', () => {
  it('returns one ordinal-0 slot per template', () => {
    expect(listCardSlots(basic, {}, null)).toEqual([{ templateId: 't_card1', ordinal: 0 }]);
    expect(listCardSlots(reversed, {}, null)).toEqual([
      { templateId: 't_card1', ordinal: 0 },
      { templateId: 't_card2', ordinal: 0 },
    ]);
    expect(listCardSlots(optional, { f_addrev: '' }, null)).toEqual([
      { templateId: 't_card1', ordinal: 0 },
      { templateId: 't_card2', ordinal: 0 },
    ]);
  });
  it('treats a missing kind as standard', () => {
    expect(listCardSlots({ ...basic, kind: 'standard', options: {} }, {}, null)).toHaveLength(1);
  });
});

describe('renderCard (standard kinds)', () => {
  it('has no interaction and answerText = fields used on the back only', () => {
    const r = renderCard(basic, { f_front: 'Q', f_back: '<b>A</b> &amp; more' }, null, {
      templateId: 't_card1',
      ordinal: 0,
    });
    expect(r.interaction).toBeNull();
    expect(r.answerText).toBe('A & more');
    expect(r.front).toBe('Q');
  });
  it('reverse card uses the other field', () => {
    const r = renderCard(reversed, { f_front: 'Q', f_back: 'A' }, null, {
      templateId: 't_card2',
      ordinal: 0,
    });
    expect(r.answerText).toBe('Q');
    expect(r.interaction).toBeNull();
  });
  it('answerText is empty when the back adds no field', () => {
    const def = {
      ...basic,
      templates: [{ id: 'x', name: 'x', front: '{{Front}}', back: '{{FrontSide}}' }],
    };
    expect(
      renderCard(def, { f_front: 'Q' }, null, { templateId: 'x', ordinal: 0 }).answerText,
    ).toBe('');
  });
  it('throws on an unknown template id', () => {
    expect(() => renderCard(basic, {}, null, { templateId: 'nope', ordinal: 0 })).toThrow();
  });
});

describe('built-in note types (US2)', () => {
  it('basic_type renders a type slot on both sides', () => {
    const bt = DEFAULT_NOTE_TYPES.find((d) => d.builtinKey === 'basic_type')!;
    expect(bt.name).toBe('Basic (type in the answer)');
    expect(bt.def.kind).toBe('standard');
    expect(bt.def.options).toEqual({ typeIgnoreCase: true, typeIgnoreDiacritics: false });
    expect(validateNoteType(bt.def)).toEqual([]);
    const r = renderCard(bt.def, { f_front: 'Capital?', f_back: 'Paris' }, null, {
      templateId: 't_card1',
      ordinal: 0,
    });
    expect(r.front).toBe('Capital?<br><span class="ad-slot" id="ad-slot-0"></span>');
    expect(r.back).toBe('Capital?<hr id="answer"><span class="ad-slot" id="ad-slot-0"></span>');
    expect(r.interaction!.answer).toMatchObject({ kind: 'type', expected: 'Paris' });
    expect(r.answerText).toBe('');
  });
});
