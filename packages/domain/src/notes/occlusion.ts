/**
 * Image occlusion (002 US4, R9): the `occlusion` filter, the one-card-per-mask fan-out, and the
 * mask helpers the API and the editor share.
 */
import { placeSlot, registerFilter } from './filters.js';
import type { Mask, NoteExtra, OcclusionMode } from './interaction.js';
import { sanitizeHtml } from './sanitize.js';
import { registerSlotLister } from './slots.js';

const EPS = 1e-9;
const MAX_LABEL = 200;

const isFraction = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;

/**
 * Why `extra` is not a usable occlusion definition (empty list when it is). Rules: at least one
 * mask; mode `hide_all` or `hide_one`; each `n` an integer >= 1, unique in the note; shape
 * `rect` or `ellipse`; `x, y, w, h` fractions in 0..1 with `w, h > 0`, `x + w <= 1`,
 * `y + h <= 1`; label (optional) a string of at most 200 characters. The API maps a non-empty
 * result to `occlusion_masks_required`. Accepts untyped input.
 */
export function validateMasks(extra: NoteExtra | null | undefined): string[] {
  const occ = extra?.occlusion as { mode?: unknown; masks?: unknown } | undefined;
  if (!occ || !Array.isArray(occ.masks) || occ.masks.length === 0)
    return ['An occlusion note needs at least one mask'];
  const errors: string[] = [];
  if (occ.mode !== 'hide_all' && occ.mode !== 'hide_one')
    errors.push('mode must be "hide_all" or "hide_one"');
  const seen = new Set<number>();
  for (const raw of occ.masks as unknown[]) {
    const mk = (raw ?? {}) as Record<string, unknown>;
    const n = mk.n;
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 1) {
      errors.push('mask n must be an integer of at least 1');
      continue;
    }
    const label = `mask ${n}`;
    if (seen.has(n)) errors.push(`mask n must be unique within the note (${n} repeats)`);
    seen.add(n);
    if (mk.shape !== 'rect' && mk.shape !== 'ellipse')
      errors.push(`${label}: shape must be "rect" or "ellipse"`);
    const { x, y, w, h } = mk;
    if (![x, y, w, h].every(isFraction)) {
      errors.push(`${label}: x, y, w and h must be numbers from 0 to 1`);
    } else {
      const [fx, fy, fw, fh] = [x, y, w, h] as number[];
      if (fw! <= 0 || fh! <= 0) errors.push(`${label}: w and h must be greater than 0`);
      if (fx! + fw! > 1 + EPS || fy! + fh! > 1 + EPS)
        errors.push(`${label}: the mask must stay inside the image (x + w and y + h at most 1)`);
    }
    if (mk.label !== undefined && (typeof mk.label !== 'string' || mk.label.length > MAX_LABEL))
      errors.push(`${label}: label must be text of at most ${MAX_LABEL} characters`);
  }
  return errors;
}

/**
 * The `n` for a new mask: one more than the largest number ever used. `usedOrdinals` is every
 * ordinal of the note's cards, soft-deleted ones included, so a number is never reused (R9).
 */
export function nextMaskN(masks: readonly Mask[], usedOrdinals: Iterable<number> = []): number {
  let max = 0;
  for (const mk of masks) max = Math.max(max, mk.n);
  for (const n of usedOrdinals) max = Math.max(max, n);
  return max + 1;
}

const unescapeAttr = (s: string): string =>
  s
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');

/** The `src` of the first image of sanitized html, or null. */
function firstImageSrc(html: string): string | null {
  const m = /<img\b[^>]*?\ssrc="([^"]*)"/i.exec(sanitizeHtml(html));
  return m ? unescapeAttr(m[1]!) : null;
}

registerFilter({
  name: 'occlusion',
  validate: ({ kind }) =>
    kind === 'image_occlusion'
      ? null
      : 'the occlusion filter can only be used in an image-occlusion note type',
  apply(value, _arg, ctx) {
    const occ = ctx.extra?.occlusion;
    const image = firstImageSrc(value.html);
    // Without an image, masks or a matching mask the card is a plain reveal of the image field.
    if (!occ || !image || !occ.masks.some((mk) => mk.n === ctx.ordinal)) return value;
    const marker = placeSlot(ctx, { kind: 'occlusion' });
    if (marker === null) return { html: '' };
    ctx.setAnswer({
      kind: 'occlusion',
      image,
      mode: occ.mode as OcclusionMode,
      masks: occ.masks.map((mk) => ({ ...mk })),
      target: ctx.ordinal,
    });
    return { html: marker };
  },
});

registerSlotLister('image_occlusion', (def, _fields, extra) => {
  const ns = [...new Set((extra?.occlusion?.masks ?? []).map((mk) => mk.n))].sort((a, b) => a - b);
  return def.templates.flatMap((t) => ns.map((ordinal) => ({ templateId: t.id, ordinal })));
});
