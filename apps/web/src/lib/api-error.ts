import type { TFunction } from 'i18next';
import { ApiError } from '../client/api';

/** A user-facing, translated message for a failed API call: one per `Problem.code`. */
export function describeApiError(t: TFunction, e: unknown): string {
  if (e instanceof ApiError) {
    if (e.code === 'network_error') return t('offline.needsConnection');
    if (e.code !== 'unknown') return t(`problem.${e.code}`);
  }
  return t('decks.error');
}
