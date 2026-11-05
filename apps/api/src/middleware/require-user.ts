import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from '../app.js';
import { ApiProblem } from '../problem.js';

/** Verified, signed-in users only. The user id becomes `c.get('userId')`; every query uses it. */
export const requireUser: MiddlewareHandler<AppEnv> = async (c, next) => {
  const auth = c.get('deps').auth;
  const session = auth ? await auth.api.getSession({ headers: c.req.raw.headers }) : null;
  if (!session?.user.emailVerified)
    throw new ApiProblem(401, 'reauth_required', 'Sign in required');
  c.set('userId', session.user.id);
  c.set('sessionCreatedAt', new Date(session.session.createdAt));
  await next();
};
