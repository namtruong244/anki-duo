import { describe, expect, it } from 'vitest';
import {
  DEFAULT_NOTE_TYPES,
  listCardSlots,
  nextMaskN,
  renderCard,
  validateMasks,
  validateNoteType,
  type Mask,
  type NoteExtra,
  type NoteTypeDef,
} from '../src/index.js';

const io = DEFAULT_NOTE_TYPES.find((d) => d.builtinKey === 'image_occlusion')!;
const IMG = 'media:0123abcd-0123-4abc-8abc-0123456789ab';
const fields = { f_image: `<img src="${IMG}">`, f_header: 'H', f_back_extra: 'extra' };
const m = (n: number, o: Partial<Mask> = {}): Mask => ({
  n,
  shape: 'rect',
  x: 0.1,
  y: 0.1,
  w: 0.2,
  h: 0.2,
  ...o,
});
const extra = (masks: Mask[], mode: 'hide_all' | 'hide_one' = 'hide_all'): NoteExtra => ({
  occlusion: { mode, masks },
});

describe('listCardSlots (image_occlusion)', () => {
  it('one ordinal per mask n, sorted', () => {
    expect(listCardSlots(io.def, fields, extra([m(5), m(2), m(9)]))).toEqual([
      { templateId: 't_card1', ordinal: 2 },
      { templateId: 't_card1', ordinal: 5 },
      { templateId: 't_card1', ordinal: 9 },
    ]);
  });
  it('is empty without masks or extra', () => {
    expect(listCardSlots(io.def, fields, null)).toEqual([]);
    expect(listCardSlots(io.def, fields, extra([]))).toEqual([]);
  });
  it('ignores duplicate numbers', () => {
    expect(listCardSlots(io.def, fields, extra([m(1), m(1)]))).toHaveLength(1);
  });
});

describe('occlusion filter', () => {
  const SLOT0 = '<span class="ad-slot" id="ad-slot-0"></span>';
  it('emits an occlusion slot and the answer', () => {
    const masks = [m(1, { label: 'heart' }), m(2, { shape: 'ellipse' })];
    const r = renderCard(io.def, fields, extra(masks, 'hide_one'), {
      templateId: 't_card1',
      ordinal: 2,
    });
    expect(r.front).toBe(`H${SLOT0}`);
    expect(r.back).toBe(`H${SLOT0}<br>extra`);
    expect(r.interaction).toEqual({
      v: 1,
      slots: [{ kind: 'occlusion' }],
      answer: { kind: 'occlusion', image: IMG, mode: 'hide_one', masks, target: 2 },
    });
    expect(r.answerText).toBe('extra');
  });
  it('accepts an https image', () => {
    const r = renderCard(
      io.def,
      { ...fields, f_image: '<div><img alt="a&amp;b" src="https://x.test/a.png?a=1&amp;b=2"></div>' },
      extra([m(1)]),
      { templateId: 't_card1', ordinal: 1 },
    );
    expect(r.interaction!.answer).toMatchObject({ image: 'https://x.test/a.png?a=1&b=2' });
  });
  it('falls back to the plain image when there is no image, extra or target', () => {
    const noExtra = renderCard(io.def, fields, null, { templateId: 't_card1', ordinal: 1 });
    expect(noExtra.interaction).toBeNull();
    expect(noExtra.front).toContain('<img');
    const noTarget = renderCard(io.def, fields, extra([m(1)]), { templateId: 't_card1', ordinal: 7 });
    expect(noTarget.interaction).toBeNull();
    const noImage = renderCard(io.def, { ...fields, f_image: 'text' }, extra([m(1)]), {
      templateId: 't_card1',
      ordinal: 1,
    });
    expect(noImage.interaction).toBeNull();
  });
  it('is valid in its kind and an error elsewhere', () => {
    expect(validateNoteType(io.def)).toEqual([]);
    const bad: NoteTypeDef = { ...io.def, kind: 'standard' };
    expect(validateNoteType(bad).join('\n')).toMatch(/occlusion/i);
  });
  it('the built-in matches the spec', () => {
    expect(io.name).toBe('Image Occlusion');
    expect(io.def.fields.map((f) => f.name)).toEqual(['Image', 'Header', 'Back Extra']);
    expect(io.def.templates[0]).toMatchObject({
      front: '{{Header}}{{occlusion:Image}}',
      back: '{{Header}}{{occlusion:Image}}<br>{{Back Extra}}',
    });
  });
});

describe('validateMasks', () => {
  it('accepts valid masks', () => {
    expect(validateMasks(extra([m(1), m(2, { x: 0.8, w: 0.2 })]))).toEqual([]);
  });
  it('needs at least one mask', () => {
    expect(validateMasks(null)).not.toEqual([]);
    expect(validateMasks({})).not.toEqual([]);
    expect(validateMasks(extra([]))).not.toEqual([]);
  });
  it('n must be a unique positive integer', () => {
    expect(validateMasks(extra([m(1), m(1)])).join()).toMatch(/unique/);
    expect(validateMasks(extra([m(0)])).join()).toMatch(/n/);
    expect(validateMasks(extra([m(1.5)])).join()).toMatch(/n/);
  });
  it('w and h must be positive and the box inside the image', () => {
    expect(validateMasks(extra([m(1, { w: 0 })]))).not.toEqual([]);
    expect(validateMasks(extra([m(1, { h: -0.1 })]))).not.toEqual([]);
    expect(validateMasks(extra([m(1, { x: 0.9, w: 0.2 })]))).not.toEqual([]);
    expect(validateMasks(extra([m(1, { y: 0.95, h: 0.1 })]))).not.toEqual([]);
    expect(validateMasks(extra([m(1, { x: -0.1 })]))).not.toEqual([]);
    expect(validateMasks(extra([m(1, { x: Number.NaN })]))).not.toEqual([]);
    expect(validateMasks(extra([m(1, { x: 0.7, w: 0.3 })]))).toEqual([]);
  });
  it('shape, mode and label are checked', () => {
    expect(validateMasks(extra([m(1, { shape: 'star' as 'rect' })]))).not.toEqual([]);
    expect(validateMasks(extra([m(1)], 'nope' as 'hide_all'))).not.toEqual([]);
    expect(validateMasks(extra([m(1, { label: 'x'.repeat(201) })]))).not.toEqual([]);
  });
});

describe('nextMaskN', () => {
  it('is max + 1', () => {
    expect(nextMaskN([])).toBe(1);
    expect(nextMaskN([m(1), m(4)])).toBe(5);
  });
  it('never reuses an ordinal ever used, such as a soft-deleted card', () => {
    expect(nextMaskN([m(1), m(2)], [1, 2, 7])).toBe(8);
  });
});
