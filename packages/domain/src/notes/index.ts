export * from './types.js';
export * from './interaction.js';
export * from './filters.js';
export * from './slots.js';
export * from './cloze.js';
export * from './furigana.js';
export { validateMasks, nextMaskN } from './occlusion.js';
import './typein.js';
import './choice.js';
import './occlusion.js';
export {
  renderCard,
  validateNoteType,
  noteTypeWarnings,
  frontFieldsWithFilter,
  hasContent,
  renameFieldInTemplates,
  type RenderOptions,
  type RenderedCard,
} from './template.js';
export { sanitizeHtml, sanitizeCss, htmlToText, stripReservedAttrs } from './sanitize.js';
export {
  DEFAULT_NOTE_TYPES,
  DEFAULT_CARD_CSS,
  type BuiltinKey,
  type BuiltinNoteType,
} from './defaults.js';

const B36 = '0123456789abcdefghijklmnopqrstuvwxyz';

export function newNoteTypeId(prefix: 'f' | 't'): string {
  const out: string[] = [];
  while (out.length < 10) {
    const bytes = new Uint8Array(16);
    globalThis.crypto.getRandomValues(bytes);
    for (const b of bytes) {
      if (b < 252 && out.length < 10) out.push(B36[b % 36]!);
    }
  }
  return `${prefix}_${out.join('')}`;
}
