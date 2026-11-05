import type { TFunction } from 'i18next';
import { ApiError } from '../client/api';

/** A user-facing message for a failed content call. */
export function describeApiError(t: TFunction, e: unknown): string {
  if (e instanceof ApiError) {
    if (e.code === 'deck_name_taken') return t('decks.nameTaken');
    if (e.code === 'card_limit_reached') return t('cards.limitReached');
    if (e.code === 'network_error') return t('offline.needsConnection');
    if (e.code === 'export_invalid') return t('decks.restoreFailed');
    if (e.code === 'media_too_large') return t('media.tooLarge');
    if (e.code === 'unsupported_media_type') return t('media.unsupported');
    if (e.code === 'media_quota_exceeded') return t('media.quota');
  }
  return t('decks.error');
}
