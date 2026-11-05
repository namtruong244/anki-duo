import {
  MAX_BACK,
  MAX_FRONT,
  MAX_TAG_LENGTH,
  MAX_TAGS,
  splitTags,
  validateRow,
} from '@anki-duo/domain';

export type CardError =
  'frontRequired' | 'frontTooLong' | 'backTooLong' | 'tooManyTags' | 'tagInvalid';

/** The same limits the API enforces (FR-009, T092), so the editor can explain before saving. */
export function validateCard(front: string, back: string, tagsText: string) {
  const tags = splitTags(tagsText);
  const r = validateRow({ front, back, tags });
  const map = {
    empty_front: 'frontRequired',
    front_too_long: 'frontTooLong',
    back_too_long: 'backTooLong',
    too_many_tags: 'tooManyTags',
    tag_invalid: 'tagInvalid',
  } as const;
  if (r.ok) return { ok: true as const, front: r.value.front, back, tags };
  return { ok: false as const, error: map[r.reason as keyof typeof map] as CardError };
}

export const LIMITS = { MAX_FRONT, MAX_BACK, MAX_TAGS, MAX_TAG_LENGTH };
