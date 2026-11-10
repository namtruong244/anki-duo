import { describe, expect, it } from 'vitest';
import {
  DEFAULT_NOTE_TYPES,
  MAX_CARDS_PER_NOTE,
  clozeAnswers,
  listCardSlots,
  renderCard,
  renderCloze,
  validateNoteType,
  type NoteTypeDef,
} from '../src/index.js';

const cloze = DEFAULT_NOTE_TYPES.find((d) => d.builtinKey === 'cloze')!.def;
const render = (text: string, n: number, extra = '') =>
  renderCard(cloze, { f_text: text, f_back_extra: extra }, null, {
    templateId: 't_card1',
    ordinal: n,
  });

describe('renderCloze', () => {
  it('hides cN on the front, shows others as plain content', () => {
    const t = 'A {{c1::one}} B {{c2::two}}';
    expect(renderCloze(t, 1, 'front')).toBe('A <span class="cloze">[...]</span> B two');
    expect(renderCloze(t, 2, 'front')).toBe('A one B <span class="cloze">[...]</span>');
  });
  it('uses the hint on the front', () => {
    expect(renderCloze('{{c1::x::a <b>hint</b> & co}}', 1, 'front')).toBe(
      '<span class="cloze">[a hint &amp; co]</span>',
    );
  });
  it('highlights the answer on the back', () => {
    expect(renderCloze('A {{c1::<b>one</b>}} {{c2::two::h}}', 1, 'back')).toBe(
      'A <span class="cloze"><b>one</b></span> two',
    );
  });
  it('hides every occurrence of a repeated number', () => {
    expect(renderCloze('{{c1::a}} {{c1::b}}', 1, 'front')).toBe(
      '<span class="cloze">[...]</span> <span class="cloze">[...]</span>',
    );
  });
  it('nesting: card 1 hides the whole outer, card 2 hides only the inner', () => {
    const t = '{{c1::capital of {{c2::France}}}}';
    expect(renderCloze(t, 1, 'front')).toBe('<span class="cloze">[...]</span>');
    expect(renderCloze(t, 2, 'front')).toBe('capital of <span class="cloze">[...]</span>');
    expect(renderCloze(t, 1, 'back')).toBe('<span class="cloze">capital of France</span>');
    expect(renderCloze(t, 2, 'back')).toBe('capital of <span class="cloze">France</span>');
  });
  it('leaves malformed markers literal', () => {
    expect(renderCloze('{{c1::abc', 1, 'front')).toBe('{{c1::abc');
  });
});

describe('clozeAnswers', () => {
  it('lists the plain-text answers of card N in order', () => {
    expect(clozeAnswers('{{c1::<b>a</b>}} x {{c2::b}} {{c1::c &amp; d}}', 1)).toEqual([
      'a',
      'c & d',
    ]);
    expect(clozeAnswers('{{c1::cap of {{c2::France}}}}', 1)).toEqual(['cap of France']);
    expect(clozeAnswers('{{c1::cap of {{c2::France}}}}', 2)).toEqual(['France']);
  });
});

describe('cloze through renderCard', () => {
  it('renders a card per number and sanitizes', () => {
    const r = render('A {{c1::<img src=x onerror=alert(1)>}} {{c2::b}}', 2);
    expect(r.front).toBe('A  <span class="cloze">[...]</span>');
    expect(r.back).toBe('A  <span class="cloze">b</span><br>');
    expect(r.interaction).toBeNull();
  });
  it('back shows Back Extra and answerText is Back Extra', () => {
    const r = render('{{c1::a}}', 1, 'extra');
    expect(r.back).toBe('<span class="cloze">a</span><br>extra');
    expect(r.answerText).toBe('extra');
  });
});

describe('listCardSlots (cloze)', () => {
  it('one ordinal per distinct N, sorted, skipped numbers make no card', () => {
    expect(
      listCardSlots(cloze, { f_text: '{{c3::a}} {{c1::b}} {{c3::c}}', f_back_extra: '' }, null),
    ).toEqual([
      { templateId: 't_card1', ordinal: 1 },
      { templateId: 't_card1', ordinal: 3 },
    ]);
  });
  it('counts nested numbers', () => {
    expect(
      listCardSlots(cloze, { f_text: '{{c1::a {{c2::b}}}}', f_back_extra: '' }, null).map(
        (s) => s.ordinal,
      ),
    ).toEqual([1, 2]);
  });
  it('ignores fields the front does not cloze', () => {
    expect(
      listCardSlots(cloze, { f_text: 'none', f_back_extra: '{{c1::x}}' }, null),
    ).toEqual([]);
  });
  it('ignores malformed markers', () => {
    expect(listCardSlots(cloze, { f_text: '{{c1::x {{c0::y}}', f_back_extra: '' }, null)).toEqual(
      [],
    );
  });
  it('reports more than the cap without truncating', () => {
    const text = Array.from({ length: 101 }, (_, i) => `{{c${i + 1}::x}}`).join(' ');
    const slots = listCardSlots(cloze, { f_text: text, f_back_extra: '' }, null);
    expect(MAX_CARDS_PER_NOTE).toBe(100);
    expect(slots.length).toBe(101);
    expect(slots.length > MAX_CARDS_PER_NOTE).toBe(true);
  });
});

describe('validateNoteType (cloze)', () => {
  const mk = (kind: NoteTypeDef['kind'], front: string): NoteTypeDef => ({
    fields: [{ id: 'a', name: 'A' }],
    templates: [{ id: 't', name: 'T', front, back: '{{A}}' }],
    css: '',
    kind,
    options: {},
  });
  it('cloze in a standard kind is an error', () => {
    expect(validateNoteType(mk('standard', '{{cloze:A}}')).join('\n')).toMatch(/cloze/i);
  });
  it('a cloze kind must use cloze on the front', () => {
    expect(validateNoteType(mk('cloze', '{{A}}')).join('\n')).toMatch(/cloze/i);
    expect(validateNoteType(mk('cloze', '{{cloze:A}}'))).toEqual([]);
  });
  it('the built-in is valid', () => {
    expect(validateNoteType(cloze)).toEqual([]);
  });
});
