import { eq } from 'drizzle-orm';
import type { AppDeps } from '../app.js';
import type { Db } from '../db/client.js';
import { schema } from '../db/client.js';
import { ApiProblem } from '../problem.js';

/** `vi*` becomes Vietnamese; everything else English (data-model LearnerSettings). */
export function localeFromAcceptLanguage(header: string | null | undefined): 'vi' | 'en' {
  const first = (header ?? '').split(',')[0]?.trim().toLowerCase() ?? '';
  return first === 'vi' || first.startsWith('vi-') ? 'vi' : 'en';
}

export function validTimeZone(tz: string | null | undefined): string {
  if (!tz) return 'UTC';
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return tz;
  } catch {
    return 'UTC';
  }
}

/** Runs once, when Better Auth creates the user. */
export async function initLearner(
  db: Db,
  userId: string,
  hints: { acceptLanguage?: string | null | undefined; timeZone?: string | null | undefined },
): Promise<void> {
  await db
    .insert(schema.learnerSettings)
    .values({
      userId,
      locale: localeFromAcceptLanguage(hints.acceptLanguage),
      timeZone: validTimeZone(hints.timeZone),
    })
    .onConflictDoNothing();
  await db.insert(schema.learnerStats).values({ userId }).onConflictDoNothing();
}

export const FRESH_SESSION_MS = 10 * 60_000;

/**
 * Deletes the learner and everything they own (FR-030). The caller must have signed in within the
 * last 10 minutes. Every table cascades from `user`; media objects are removed from storage too.
 */
export async function deleteAccount(
  deps: AppDeps,
  userId: string,
  sessionCreatedAt: Date,
): Promise<void> {
  const { db, now, storage } = deps;
  if (now().getTime() - sessionCreatedAt.getTime() > FRESH_SESSION_MS) {
    throw new ApiProblem(403, 'reauth_required', 'Sign in again to delete your account');
  }
  const keys = (
    await db
      .select({ key: schema.mediaAsset.storageKey })
      .from(schema.mediaAsset)
      .where(eq(schema.mediaAsset.userId, userId))
  ).map((m) => m.key);
  await db.delete(schema.user).where(eq(schema.user.id, userId));
  // Rows first: a failed object delete leaves an orphan file, never a half-deleted account.
  for (const key of keys) await storage?.delete(key).catch(() => undefined);
}
