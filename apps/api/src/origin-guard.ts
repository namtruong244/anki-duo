import { createHash, timingSafeEqual } from 'node:crypto';
import type { MiddlewareHandler } from 'hono';
import type { Env } from './env.js';
import { ApiProblem, problemResponse } from './problem.js';

const digest = (s: string) => createHash('sha256').update(s).digest();

/** Constant time, and independent of the secret's length (both sides are hashed first). */
const safeEqual = (a: string, b: string) => timingSafeEqual(digest(a), digest(b));

/**
 * Only the Cloudflare Worker may reach the Lambda URL: it adds `x-origin-secret`. During a
 * rotation the previous secret is accepted too. With no secret configured the guard fails closed.
 * Skipped in development, where Vite proxies directly.
 */
export function originGuard(
  env: Pick<Env, 'NODE_ENV' | 'ORIGIN_SECRET' | 'ORIGIN_SECRET_PREVIOUS'>,
): MiddlewareHandler {
  return async (c, next) => {
    if (env.NODE_ENV === 'development') return next();
    const got = c.req.header('x-origin-secret') ?? '';
    const accepted = [env.ORIGIN_SECRET, env.ORIGIN_SECRET_PREVIOUS].filter(
      (s): s is string => !!s,
    );
    let ok = false;
    for (const secret of accepted) ok = safeEqual(got, secret) || ok;
    if (!ok || got === '')
      return problemResponse(new ApiProblem(403, 'reauth_required', 'Forbidden'));
    return next();
  };
}
