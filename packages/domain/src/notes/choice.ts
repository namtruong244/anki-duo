/** The `choice` filter (002 US3, R8): option buttons for a multiple-choice note type. */
import { splitWrongAnswers } from '../answer/choices.js';
import { normalizeAnswer } from '../answer/compare.js';
import { placeSlot, registerFilter } from './filters.js';
import { htmlToText, sanitizeHtml, stripReservedAttrs } from './sanitize.js';

registerFilter({
  name: 'choice',
  validate: ({ kind }) =>
    kind === 'multiple_choice'
      ? null
      : 'the choice filter can only be used in a multiple-choice note type',
  apply(value, _arg, ctx) {
    const roles = ctx.options.roles;
    if (!roles) return { html: '' };
    const correct = htmlToText(value.html);
    const norm = { ignoreCase: true, ignoreDiacritics: false };
    const key = normalizeAnswer(correct, norm);
    const wrong = splitWrongAnswers(ctx.fields[roles.wrong] ?? '').filter(
      (w) => normalizeAnswer(w, norm) !== key,
    );
    const marker = placeSlot(ctx, { kind: 'choice' });
    ctx.setAnswerText(correct);
    if (marker === null) return { html: '' };
    ctx.setAnswer({
      kind: 'choice',
      correct,
      wrong,
      explanationHtml: sanitizeHtml(stripReservedAttrs(ctx.fields[roles.explanation] ?? '')),
    });
    return { html: marker };
  },
});
