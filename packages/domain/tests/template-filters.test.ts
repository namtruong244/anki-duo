import { describe, expect, it } from 'vitest';
import {
  DEFAULT_NOTE_TYPES,
  noteTypeWarnings,
  registerFilter,
  renameFieldInTemplates,
  renderCard,
  validateNoteType,
  type NoteTypeDef,
} from '../src/index.js';

function def(front: string, back = ''): NoteTypeDef {
  return {
    fields: [
      { id: 'a', name: 'A' },
      { id: 'b', name: 'Field B' },
    ],
    templates: [{ id: 't', name: 'T', front, back }],
    css: '',
  };
}
const render = (d: NoteTypeDef, fields: Record<string, string>) =>
  renderCard(d, fields, null, { templateId: 't', ordinal: 0 });

describe('filter chain tokenizer', () => {
  it('treats the last segment as the field and tolerates spaces in field names', () => {
    expect(render(def('{{text:Field B}}'), { b: '<b>x</b>' }).front).toBe('x');
    expect(render(def('{{ text : A }}'), { a: '<i>y</i>' }).front).toBe('y');
  });
  it('{{text:Field}} still strips HTML and escapes', () => {
    expect(render(def('{{text:A}}'), { a: '<b>x&y</b>' }).front).toBe('x&amp;y');
  });
  it('applies filters right to left', () => {
    const log: string[] = [];
    registerFilter({
      name: 'tst_wrap',
      apply: (v) => (log.push('wrap'), { html: `<b>${v.html}</b>` }),
    });
    registerFilter({
      name: 'tst_upper',
      apply: (v) => (log.push('upper'), { html: v.html.toUpperCase() }),
    });
    const d = def('{{tst_wrap:tst_upper:A}}');
    expect(validateNoteType(d)).toEqual([]);
    expect(render(d, { a: 'abc' }).front).toBe('<b>ABC</b>');
    expect(log).toEqual(['upper', 'wrap']);
  });
  it('passes the argument to a filter and validates required arguments', () => {
    let seen: string | undefined;
    registerFilter({
      name: 'tst_arg',
      arg: 'required',
      apply: (v, arg) => ((seen = arg), v),
    });
    expect(render(def('{{tst_arg en-US:A}}'), { a: 'x' }).front).toBe('x');
    expect(seen).toBe('en-US');
    expect(validateNoteType(def('{{tst_arg:A}}')).join('\n')).toMatch(/needs an argument/i);
  });
  it('lets a filter emit a slot and set the answer', () => {
    registerFilter({
      name: 'tst_slot',
      apply: (v, _arg, ctx) => {
        const marker = ctx.addSlot({ kind: 'type' });
        ctx.setAnswer({
          kind: 'type',
          expected: v.html,
          ignoreCase: true,
          ignoreDiacritics: false,
        });
        ctx.setAnswerText('answer!');
        return { html: marker };
      },
    });
    const r = render(def('{{tst_slot:A}}'), { a: 'exp' });
    expect(r.front).toBe('<span class="ad-slot" id="ad-slot-0"></span>');
    expect(r.interaction).toEqual({
      v: 1,
      slots: [{ kind: 'type' }],
      answer: { kind: 'type', expected: 'exp', ignoreCase: true, ignoreDiacritics: false },
    });
    expect(r.answerText).toBe('answer!');
  });
  it('does not emit slots inside attributes', () => {
    const d = def('<div title="{{tst_slot:A}}">x</div>');
    expect(render(d, { a: 'e' }).front).not.toContain('ad-slot');
  });
});

describe('unknown filters and arguments', () => {
  it('validateNoteType reports an unknown filter', () => {
    const errs = validateNoteType(def('{{nope:A}}'));
    expect(errs.join('\n')).toMatch(/unknown filter "nope"/);
  });
  it('render shows an error span for an unknown filter', () => {
    const r = render(def('{{nope:A}}'), { a: 'x' });
    expect(r.front).toBe('<span class="tpl-error">Unknown filter: nope</span>');
  });
  it('tts without a language is an error', () => {
    registerFilter({ name: 'tts', arg: 'required', apply: (v) => v });
    const errs = validateNoteType(def('{{tts:A}}'));
    expect(errs.join('\n')).toMatch(/tts.*needs an argument/i);
    expect(validateNoteType(def('{{tts en-US:A}}'))).toEqual([]);
  });
  it('text takes no argument', () => {
    expect(validateNoteType(def('{{text x:A}}')).join('\n')).toMatch(/takes no argument/);
  });
  it('an unknown field behind a valid filter is still an unknown field', () => {
    expect(validateNoteType(def('{{text:Nope}}')).join('\n')).toMatch(/unknown field "Nope"/);
  });
});

describe('renameFieldInTemplates with chains', () => {
  it('rewrites the field inside any chain and keeps filter arguments', () => {
    const d = def('{{type:cloze:A}}{{tts en-US:A}}{{ text : A }}{{#A}}x{{/A}}{{Field B}}', '{{A}}');
    const r = renameFieldInTemplates(d, 'A', 'New A').templates[0]!;
    expect(r.front).toBe(
      '{{type:cloze:New A}}{{tts en-US:New A}}{{text:New A}}{{#New A}}x{{/New A}}{{Field B}}',
    );
    expect(r.back).toBe('{{New A}}');
  });
  it('does not touch a filter name that equals the old field name', () => {
    const d = def('{{A:B2}}');
    expect(renameFieldInTemplates(d, 'A', 'Z').templates[0]!.front).toBe('{{A:B2}}');
  });
});

describe('hint filter', () => {
  const d: NoteTypeDef = {
    fields: [{ id: 'n', name: 'Notes' }],
    templates: [{ id: 't', name: 'T', front: '{{hint:Notes}}', back: '' }],
    css: '',
  };
  it('wraps a non-empty field in a details element with an empty summary', () => {
    expect(render(d, { n: 'a <b>b</b>' }).front).toBe(
      '<details class="ad-hint"><summary></summary>a <b>b</b></details>',
    );
  });
  it('renders nothing for an empty field', () => {
    expect(render(d, { n: '' }).front).toBe('');
    expect(render(d, { n: '<br>' }).front).toBe('');
  });
  it('strips author-made reserved classes', () => {
    expect(render(d, { n: '<span class="ad-slot">x</span>' }).front).toBe(
      '<details class="ad-hint"><summary></summary><span>x</span></details>',
    );
  });
});

describe('type filter', () => {
  const tdef = (front: string, back = '', options: NoteTypeDef['options'] = {}): NoteTypeDef => ({
    fields: [
      { id: 'q', name: 'Q' },
      { id: 'a', name: 'A' },
    ],
    templates: [{ id: 't', name: 'T', front, back }],
    css: '',
    kind: 'standard',
    options,
  });
  const SLOT0 = '<span class="ad-slot" id="ad-slot-0"></span>';

  it('emits one type slot with the options copied into the answer', () => {
    const d = tdef('{{Q}}<br>{{type:A}}', '{{Q}}<hr id=answer>{{type:A}}', {
      typeIgnoreCase: false,
      typeIgnoreDiacritics: true,
    });
    const r = render(d, { q: 'Q?', a: '<b>Paris</b>' });
    expect(r.front).toBe(`Q?<br>${SLOT0}`);
    expect(r.back).toBe(`Q?<hr id="answer">${SLOT0}`);
    expect(r.interaction).toEqual({
      v: 1,
      slots: [{ kind: 'type' }],
      answer: { kind: 'type', expected: 'Paris', ignoreCase: false, ignoreDiacritics: true },
    });
    expect(validateNoteType(d)).toEqual([]);
    expect(noteTypeWarnings(d)).toEqual([]);
  });
  it('defaults: ignoreCase on, ignoreDiacritics off', () => {
    const r = render(tdef('{{type:A}}'), { a: 'x' });
    expect(r.interaction!.answer).toMatchObject({ ignoreCase: true, ignoreDiacritics: false });
  });
  it('an empty expected answer gives no slot and no answer', () => {
    const r = render(tdef('{{Q}}{{type:A}}', '{{type:A}}'), { q: 'Q', a: '<br>' });
    expect(r.interaction).toBeNull();
    expect(r.front).toBe('Q');
  });
  it('a second type tag renders the expected text statically and warns', () => {
    const d = tdef('{{type:A}} / {{type:A}}');
    const r = render(d, { a: 'a&lt;b' });
    expect(r.front).toBe(`${SLOT0} / a&lt;b`);
    expect(r.interaction!.slots).toHaveLength(1);
    expect(noteTypeWarnings(d).join('\n')).toMatch(/more than one/);
    expect(validateNoteType(d)).toEqual([]);
  });
  it('a type tag only on the back is static and warns', () => {
    const d = tdef('{{Q}}', '{{FrontSide}}{{type:A}}');
    const r = render(d, { q: 'Q', a: 'ans' });
    expect(r.back).toBe('Qans');
    expect(r.interaction).toBeNull();
    expect(noteTypeWarnings(d).join('\n')).toMatch(/only on the back/);
  });
  it('type:cloze uses the answers of card N joined with a comma', () => {
    const c: NoteTypeDef = {
      fields: [{ id: 'x', name: 'Text' }],
      templates: [
        {
          id: 't',
          name: 'T',
          front: '{{cloze:Text}}{{type:cloze:Text}}',
          back: '{{cloze:Text}}{{type:cloze:Text}}',
        },
      ],
      css: '',
      kind: 'cloze',
      options: {},
    };
    expect(validateNoteType(c)).toEqual([]);
    const f = { x: '{{c1::Paris}} is in {{c2::France}}, {{c1::<i>Ile</i>}}' };
    const r1 = renderCard(c, f, null, { templateId: 't', ordinal: 1 });
    expect(r1.interaction!.answer).toEqual({
      kind: 'type',
      expected: 'Paris, Ile',
      ignoreCase: true,
      ignoreDiacritics: false,
    });
    expect(r1.front).toBe(
      `<span class="cloze">[...]</span> is in France, <span class="cloze">[...]</span>${SLOT0}`,
    );
    const r2 = renderCard(c, f, null, { templateId: 't', ordinal: 2 });
    expect(r2.interaction!.answer).toMatchObject({ expected: 'France' });
  });
  it('type:cloze in a standard kind is an invalid chain', () => {
    expect(validateNoteType(tdef('{{type:cloze:A}}')).join('\n')).toMatch(/cloze/i);
  });
});

describe('choice filter', () => {
  const mc = (options: NoteTypeDef['options'], kind: NoteTypeDef['kind'] = 'multiple_choice'): NoteTypeDef => ({
    fields: [
      { id: 'q', name: 'Question' },
      { id: 'c', name: 'Correct' },
      { id: 'w', name: 'Wrong' },
      { id: 'e', name: 'Expl' },
    ],
    templates: [
      {
        id: 't',
        name: 'T',
        front: '{{Question}}{{choice:Correct}}',
        back: '{{Question}}{{choice:Correct}}<hr id=answer>{{Expl}}',
      },
    ],
    css: '',
    kind,
    options,
  });
  const roles = { correct: 'c', wrong: 'w', explanation: 'e' };
  const SLOT0 = '<span class="ad-slot" id="ad-slot-0"></span>';
  it('emits a choice slot and the answer record', () => {
    const d = mc({ roles });
    expect(validateNoteType(d)).toEqual([]);
    const r = render(d, {
      q: 'Capital?',
      c: '<b>Paris</b>',
      w: 'Rome<br>Oslo<p>Bern</p>Rome\n  oslo \n\n',
      e: 'Because <i>France</i><script>x</script>',
    });
    expect(r.front).toBe(`Capital?${SLOT0}`);
    expect(r.back).toBe(`Capital?${SLOT0}<hr id="answer">Because <i>France</i>`);
    expect(r.interaction).toEqual({
      v: 1,
      slots: [{ kind: 'choice' }],
      answer: {
        kind: 'choice',
        correct: 'Paris',
        wrong: ['Rome', 'Oslo', 'Bern'],
        explanationHtml: 'Because <i>France</i>',
      },
    });
    expect(r.answerText).toBe('Paris');
  });
  it('keeps all wrong answers (no sampling in the record)', () => {
    const w = Array.from({ length: 12 }, (_, i) => `w${i}`).join('<br>');
    const r = render(mc({ roles }), { c: 'ok', w, q: '', e: '' });
    expect((r.interaction!.answer as { wrong: string[] }).wrong).toHaveLength(12);
  });
  it('a missing wrong-answers field gives an empty list', () => {
    const r = render(mc({ roles }), { c: 'ok' });
    expect(r.interaction!.answer).toMatchObject({ correct: 'ok', wrong: [], explanationHtml: '' });
  });
  it('choice outside multiple_choice is a validation error', () => {
    expect(validateNoteType(mc({ roles }, 'standard')).join('\n')).toMatch(/choice/i);
  });
  it('a multiple_choice kind without roles (or with unknown field ids) is an error', () => {
    expect(validateNoteType(mc({})).join('\n')).toMatch(/roles/);
    expect(validateNoteType(mc({ roles: { ...roles, wrong: 'zzz' } })).join('\n')).toMatch(/roles/);
  });
  it('without roles the tag renders nothing', () => {
    const r = render(mc({}), { c: 'ok' });
    expect(r.interaction).toBeNull();
  });
  it('the built-in is valid', () => {
    const b = DEFAULT_NOTE_TYPES.find((x) => x.builtinKey === 'multiple_choice')!;
    expect(b.name).toBe('Multiple choice');
    expect(b.def.kind).toBe('multiple_choice');
    expect(validateNoteType(b.def)).toEqual([]);
    const r = renderCard(
      b.def,
      { f_question: 'Q', f_correct: 'A', f_wrong_answers: 'B<br>C', f_explanation: 'because' },
      null,
      { templateId: 't_card1', ordinal: 0 },
    );
    expect(r.interaction!.answer).toMatchObject({ correct: 'A', wrong: ['B', 'C'] });
    expect(r.back).toContain('because');
    expect(r.answerText).toBe('A');
  });
});

describe('tts filter', () => {
  const tdef = (front: string, back = ''): NoteTypeDef => ({
    fields: [{ id: 'a', name: 'A' }],
    templates: [{ id: 't', name: 'T', front, back }],
    css: '',
  });
  const SLOT0 = '<span class="ad-slot" id="ad-slot-0"></span>';
  it('emits a tts slot with the plain text and a normalized language', () => {
    const d = tdef('{{tts en_US:A}}', '{{FrontSide}}');
    expect(validateNoteType(d)).toEqual([]);
    const r = render(d, { a: 'Hello <b>big</b> &amp; world' });
    expect(r.front).toBe(SLOT0);
    expect(r.interaction).toEqual({
      v: 1,
      slots: [{ kind: 'tts', lang: 'en-US', text: 'Hello big & world' }],
      answer: null,
    });
  });
  it('normalizes the case of language, script and region', () => {
    const lang = (arg: string) =>
      (render(tdef(`{{tts ${arg}:A}}`), { a: 'x' }).interaction!.slots[0] as { lang: string }).lang;
    expect(lang('en-US')).toBe('en-US');
    expect(lang('EN_us')).toBe('en-US');
    expect(lang('ja')).toBe('ja');
    expect(lang('zh_hant_tw')).toBe('zh-Hant-TW');
    expect(lang('VI-vn')).toBe('vi-VN');
  });
  it('a missing language is a validation error, and so is a malformed one', () => {
    expect(validateNoteType(tdef('{{tts:A}}')).join('\n')).toMatch(/tts.*needs an argument/i);
    expect(validateNoteType(tdef('{{tts e:A}}')).join('\n')).toMatch(/language/i);
    expect(validateNoteType(tdef('{{tts en US:A}}')).join('\n')).toMatch(/language/i);
    expect(validateNoteType(tdef('{{tts en_US:A}}'))).toEqual([]);
  });
  it('renders nothing for an empty field', () => {
    expect(render(tdef('x{{tts en-US:A}}'), { a: '<br>' }).interaction).toBeNull();
  });
  it('a tts tag on the back reuses the same slot', () => {
    const r = render(tdef('{{tts en-US:A}}', '{{tts en-US:A}}'), { a: 'hi' });
    expect(r.back).toBe(SLOT0);
    expect(r.interaction!.slots).toHaveLength(1);
  });
  it('two different tts tags make two slots', () => {
    const d: NoteTypeDef = {
      fields: [
        { id: 'a', name: 'A' },
        { id: 'b', name: 'B' },
      ],
      templates: [{ id: 't', name: 'T', front: '{{tts en-US:A}}{{tts ja-JP:B}}', back: '' }],
      css: '',
    };
    const r = render(d, { a: 'hi', b: 'やあ' });
    expect(r.interaction!.slots).toEqual([
      { kind: 'tts', lang: 'en-US', text: 'hi' },
      { kind: 'tts', lang: 'ja-JP', text: 'やあ' },
    ]);
  });
});
