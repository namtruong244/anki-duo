import type { NoteTypeKind, NoteTypeOptions } from './interaction.js';
import type { NoteTypeDef } from './types.js';

export const DEFAULT_CARD_CSS = `.card {
  font-family: inherit;
  font-size: 24px;
  text-align: center;
  color: var(--color-text, #3c3c3c);
}
`;

const F_FRONT = { id: 'f_front', name: 'Front' };
const F_BACK = { id: 'f_back', name: 'Back' };
const F_ADDREV = { id: 'f_addrev', name: 'Add Reverse' };

const CARD1 = {
  id: 't_card1',
  name: 'Card 1',
  front: '{{Front}}',
  back: '{{FrontSide}}<hr id=answer>{{Back}}',
};

export type BuiltinKey =
  | 'basic'
  | 'basic_reversed'
  | 'basic_optional_reversed'
  | 'cloze'
  | 'basic_type'
  | 'multiple_choice'
  | 'image_occlusion';

/** A built-in note type; `builtinKey` is stored on the row (R14). */
export interface BuiltinNoteType {
  builtinKey: BuiltinKey;
  /** Same as `builtinKey`; kept for 001 callers. */
  key: BuiltinKey;
  name: string;
  def: NoteTypeDef & { kind: NoteTypeKind; options: NoteTypeOptions };
}

export const DEFAULT_NOTE_TYPES: ReadonlyArray<BuiltinNoteType> = [
  {
    builtinKey: 'basic',
    key: 'basic',
    name: 'Basic',
    def: {
      fields: [F_FRONT, F_BACK],
      templates: [CARD1],
      css: DEFAULT_CARD_CSS,
      kind: 'standard',
      options: {},
    },
  },
  {
    builtinKey: 'basic_reversed',
    key: 'basic_reversed',
    name: 'Basic (and reversed card)',
    def: {
      fields: [F_FRONT, F_BACK],
      templates: [
        CARD1,
        {
          id: 't_card2',
          name: 'Card 2',
          front: '{{Back}}',
          back: '{{FrontSide}}<hr id=answer>{{Front}}',
        },
      ],
      css: DEFAULT_CARD_CSS,
      kind: 'standard',
      options: {},
    },
  },
  {
    builtinKey: 'basic_optional_reversed',
    key: 'basic_optional_reversed',
    name: 'Basic (optional reversed card)',
    def: {
      fields: [F_FRONT, F_BACK, F_ADDREV],
      templates: [
        CARD1,
        {
          id: 't_card2',
          name: 'Card 2',
          front: '{{#Add Reverse}}{{Back}}{{/Add Reverse}}',
          back: '{{FrontSide}}<hr id=answer>{{Front}}',
        },
      ],
      css: DEFAULT_CARD_CSS,
      kind: 'standard',
      options: {},
    },
  },
  {
    builtinKey: 'cloze',
    key: 'cloze',
    name: 'Cloze',
    def: {
      fields: [
        { id: 'f_text', name: 'Text' },
        { id: 'f_back_extra', name: 'Back Extra' },
      ],
      templates: [
        {
          id: 't_card1',
          name: 'Card 1',
          front: '{{cloze:Text}}',
          back: '{{cloze:Text}}<br>{{Back Extra}}',
        },
      ],
      css: DEFAULT_CARD_CSS,
      kind: 'cloze',
      options: {},
    },
  },
  {
    builtinKey: 'basic_type',
    key: 'basic_type',
    name: 'Basic (type in the answer)',
    def: {
      fields: [F_FRONT, F_BACK],
      templates: [
        {
          id: 't_card1',
          name: 'Card 1',
          front: '{{Front}}<br>{{type:Back}}',
          back: '{{Front}}<hr id=answer>{{type:Back}}',
        },
      ],
      css: DEFAULT_CARD_CSS,
      kind: 'standard',
      options: { typeIgnoreCase: true, typeIgnoreDiacritics: false },
    },
  },
  {
    builtinKey: 'multiple_choice',
    key: 'multiple_choice',
    name: 'Multiple choice',
    def: {
      fields: [
        { id: 'f_question', name: 'Question' },
        { id: 'f_correct', name: 'Correct' },
        { id: 'f_wrong_answers', name: 'Wrong answers' },
        { id: 'f_explanation', name: 'Explanation' },
      ],
      templates: [
        {
          id: 't_card1',
          name: 'Card 1',
          front: '{{Question}}{{choice:Correct}}',
          back: '{{Question}}{{choice:Correct}}<hr id=answer>{{Explanation}}',
        },
      ],
      css: DEFAULT_CARD_CSS,
      kind: 'multiple_choice',
      options: {
        roles: { correct: 'f_correct', wrong: 'f_wrong_answers', explanation: 'f_explanation' },
      },
    },
  },
  {
    builtinKey: 'image_occlusion',
    key: 'image_occlusion',
    name: 'Image Occlusion',
    def: {
      fields: [
        { id: 'f_image', name: 'Image' },
        { id: 'f_header', name: 'Header' },
        { id: 'f_back_extra', name: 'Back Extra' },
      ],
      templates: [
        {
          id: 't_card1',
          name: 'Card 1',
          front: '{{Header}}{{occlusion:Image}}',
          back: '{{Header}}{{occlusion:Image}}<br>{{Back Extra}}',
        },
      ],
      css: DEFAULT_CARD_CSS,
      kind: 'image_occlusion',
      options: {},
    },
  },
];
