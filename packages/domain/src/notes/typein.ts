/** The `type` filter (002 US2, R6, R15): the answer box on the front, the diff on the back. */
import { placeSlot, registerFilter } from './filters.js';
import { escapeHtml, htmlToText } from './sanitize.js';

registerFilter({
  name: 'type',
  apply(value, _arg, ctx) {
    // `type:cloze:Field` gets the joined answers of card N from the cloze filter to its right.
    const expected = (value.expected ?? htmlToText(value.html)).trim();
    if (!expected) return { html: '' };
    // Only the first type tag of a card is interactive; a back-only or repeated one is static.
    const marker = placeSlot(ctx, { kind: 'type' }, true);
    if (marker === null) return { html: escapeHtml(expected) };
    ctx.setAnswer({
      kind: 'type',
      expected,
      ignoreCase: ctx.options.typeIgnoreCase ?? true,
      ignoreDiacritics: ctx.options.typeIgnoreDiacritics ?? false,
    });
    return { html: marker };
  },
});
