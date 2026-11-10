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

export const DEFAULT_NOTE_TYPES: ReadonlyArray<{
  key: 'basic' | 'basic_reversed' | 'basic_optional_reversed';
  name: string;
  def: NoteTypeDef;
}> = [
  {
    key: 'basic',
    name: 'Basic',
    def: { fields: [F_FRONT, F_BACK], templates: [CARD1], css: DEFAULT_CARD_CSS },
  },
  {
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
    },
  },
  {
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
    },
  },
];
