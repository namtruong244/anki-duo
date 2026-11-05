export const MAX_FRONT = 10_000;
export const MAX_BACK = 10_000;
export const MAX_TAGS = 20;
export const MAX_TAG_LENGTH = 50;

export type RowReason =
  | 'empty_front'
  | 'front_too_long'
  | 'back_too_long'
  | 'too_many_tags'
  | 'tag_invalid'
  | 'malformed_row'
  | 'duplicate_skipped'
  | 'card_limit_reached';

export interface RowInput {
  front: string;
  back: string;
  tags: readonly string[];
}

/**
 * The key used to find duplicates (FR-013): lower-case, NFC, trimmed, with runs of whitespace
 * collapsed to one space.
 */
export const normaliseFront = (front: string): string =>
  front.normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase();

/** Tags are separated by whitespace or `;`. */
export const splitTags = (raw: string): string[] => raw.split(/[\s;]+/).filter((t) => t.length > 0);

// Postgres counts code points, so do the same.
const length = (s: string) => [...s].length;

export function validateRow(
  row: RowInput,
): { ok: true; value: RowInput } | { ok: false; reason: RowReason } {
  const front = row.front.trim();
  if (front.length === 0) return { ok: false, reason: 'empty_front' };
  if (length(front) > MAX_FRONT) return { ok: false, reason: 'front_too_long' };
  if (length(row.back) > MAX_BACK) return { ok: false, reason: 'back_too_long' };
  if (row.tags.length > MAX_TAGS) return { ok: false, reason: 'too_many_tags' };
  if (row.tags.some((t) => t.length === 0 || /\s/.test(t) || length(t) > MAX_TAG_LENGTH)) {
    return { ok: false, reason: 'tag_invalid' };
  }
  return { ok: true, value: { front, back: row.back, tags: [...row.tags] } };
}
