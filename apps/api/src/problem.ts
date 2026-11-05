import type { Context } from 'hono';
import type { ProblemCode } from '@anki-duo/contract';

const TITLES: Record<ProblemCode, string> = {
  validation_failed: 'Validation failed',
  not_found: 'Not found',
  deck_name_taken: 'Deck name already in use',
  card_limit_reached: 'Card limit reached',
  media_quota_exceeded: 'Media quota exceeded',
  media_too_large: 'Media file too large',
  unsupported_media_type: 'Unsupported media type',
  import_too_large: 'Import too large',
  import_bad_encoding: 'Import file encoding not supported',
  export_invalid: 'Invalid export file',
  rate_limited: 'Too many requests',
  reauth_required: 'Sign in again',
};

export interface ProblemBody {
  type: string;
  title: string;
  status: number;
  code: ProblemCode;
  detail?: string;
  errors?: { path?: string; message?: string }[];
}

/** Thrown anywhere in a handler; the error handler turns it into application/problem+json. */
export class ApiProblem extends Error {
  constructor(
    readonly status: number,
    readonly code: ProblemCode,
    detail?: string,
    readonly errors?: ProblemBody['errors'],
    readonly headers?: Record<string, string>,
  ) {
    super(detail ?? TITLES[code]);
  }

  body(): ProblemBody {
    return {
      type: `about:blank#${this.code}`,
      title: TITLES[this.code],
      status: this.status,
      code: this.code,
      ...(this.message !== TITLES[this.code] ? { detail: this.message } : {}),
      ...(this.errors ? { errors: this.errors } : {}),
    };
  }
}

export function problemResponse(p: ApiProblem): Response {
  return new Response(JSON.stringify(p.body()), {
    status: p.status,
    headers: { 'content-type': 'application/problem+json', ...p.headers },
  });
}

export const problem = (c: Context, status: number, code: ProblemCode, detail?: string) =>
  problemResponse(new ApiProblem(status, code, detail));

/** Zod validation hook for `@hono/zod-openapi` routes. */
export function validationHook(
  result: { success: boolean; error?: { issues: { path: PropertyKey[]; message: string }[] } },
  c: Context,
) {
  if (result.success) return undefined;
  const status = /\/(cards|import|restore)(\/|$)/.test(c.req.path) ? 422 : 400;
  return problemResponse(
    new ApiProblem(
      status,
      'validation_failed',
      undefined,
      (result.error?.issues ?? []).map((i) => ({
        path: i.path.map(String).join('.'),
        message: i.message,
      })),
    ),
  );
}
