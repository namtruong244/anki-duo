import type { TFunction } from 'i18next';

export type AuthErrorKind =
  | 'emailNotVerified'
  | 'invalidCredentials'
  | 'userExists'
  | 'passwordTooShort'
  | 'passwordTooLong'
  | 'invalidEmail'
  | 'invalidToken'
  | 'rateLimited'
  | 'network'
  | 'generic';

export interface AuthErrorInfo {
  kind: AuthErrorKind;
  /** i18n key under `auth.errors.*`. */
  key: string;
}

/** Minimum password length enforced by the API (`minPasswordLength`). */
export const MIN_PASSWORD_LENGTH = 10;

interface ErrorLike {
  code?: unknown;
  status?: unknown;
  message?: unknown;
  name?: unknown;
}

/** Classifies a better-auth client error (or a thrown fetch failure). */
export function classifyAuthError(err: unknown): AuthErrorInfo {
  const e = (err ?? {}) as ErrorLike;
  const code = typeof e.code === 'string' ? e.code.toUpperCase() : '';
  const status = typeof e.status === 'number' ? e.status : undefined;
  let kind: AuthErrorKind;
  switch (code) {
    case 'EMAIL_NOT_VERIFIED':
      kind = 'emailNotVerified';
      break;
    case 'INVALID_EMAIL_OR_PASSWORD':
      kind = 'invalidCredentials';
      break;
    case 'USER_ALREADY_EXISTS':
    case 'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL':
      kind = 'userExists';
      break;
    case 'PASSWORD_TOO_SHORT':
      kind = 'passwordTooShort';
      break;
    case 'PASSWORD_TOO_LONG':
      kind = 'passwordTooLong';
      break;
    case 'INVALID_EMAIL':
      kind = 'invalidEmail';
      break;
    case 'INVALID_TOKEN':
    case 'TOKEN_EXPIRED':
      kind = 'invalidToken';
      break;
    default:
      if (status === 429) kind = 'rateLimited';
      else if (status === 403 && /verif/i.test(String(e.message ?? ''))) kind = 'emailNotVerified';
      else if (status === 0 || err instanceof TypeError || e.name === 'TypeError') kind = 'network';
      else if (
        status === undefined &&
        code === '' &&
        /failed to fetch|network/i.test(String(e.message ?? ''))
      )
        kind = 'network';
      else kind = 'generic';
  }
  return { kind, key: `auth.errors.${kind}` };
}

/** Maps a better-auth client error to a specific, translated message. */
export function authErrorMessage(err: unknown, t: TFunction): string {
  return t(classifyAuthError(err).key);
}
