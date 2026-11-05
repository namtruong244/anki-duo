import { randomUUID } from 'node:crypto';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { bearer } from 'better-auth/plugins';
import type { AppDeps } from './app.js';
import { schema } from './db/client.js';
import { createMailer } from './mailer.js';
import { initLearner } from './services/account.js';

/**
 * Better Auth (research R4): email + password with verification and reset, Google (including
 * `idToken` sign-in for native clients), cookie sessions for the web, and the bearer plugin so a
 * future Flutter client can send the same session as `Authorization: Bearer`.
 */
export function createAuth(deps: Pick<AppDeps, 'db' | 'env' | 'mailer'>) {
  const { db, env } = deps;
  const mailer = deps.mailer ?? createMailer(env);
  const baseURL = env.BETTER_AUTH_URL ?? 'http://localhost:5173';
  const google =
    env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
      ? { google: { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET } }
      : {};

  return betterAuth({
    baseURL,
    secret: env.BETTER_AUTH_SECRET ?? '',
    trustedOrigins: [baseURL],
    database: drizzleAdapter(db, {
      provider: 'pg',
      schema: {
        user: schema.user,
        session: schema.session,
        account: schema.account,
        verification: schema.verification,
      },
    }),
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      minPasswordLength: 10,
      sendResetPassword: async ({ user, url }) => mailer.sendPasswordReset(user.email, url),
    },
    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: true,
      sendVerificationEmail: async ({ user, url }) => mailer.sendVerification(user.email, url),
    },
    socialProviders: google,
    plugins: [bearer()],
    rateLimit: { enabled: env.NODE_ENV === 'production', storage: 'memory' },
    advanced: {
      // The Worker puts the real client address in x-forwarded-for.
      ipAddress: { ipAddressHeaders: ['x-forwarded-for'] },
      // Anything but local development is served over HTTPS.
      useSecureCookies: env.NODE_ENV !== 'development',
      defaultCookieAttributes: { httpOnly: true, sameSite: 'lax' },
      database: { generateId: () => randomUUID() },
    },
    databaseHooks: {
      user: {
        create: {
          after: async (user, ctx) => {
            const h = ctx?.request?.headers ?? ctx?.headers;
            await initLearner(db, user.id, {
              acceptLanguage: h?.get('accept-language'),
              timeZone: h?.get('x-time-zone'),
            });
          },
        },
      },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;
