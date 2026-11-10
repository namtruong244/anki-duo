export * from './types.js';
export { renderCard, validateNoteType, renameFieldInTemplates } from './template.js';
export { sanitizeHtml, sanitizeCss, htmlToText } from './sanitize.js';
export { DEFAULT_NOTE_TYPES, DEFAULT_CARD_CSS } from './defaults.js';

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
