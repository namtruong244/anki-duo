import type { Db } from '../db/client.js';
import { schema } from '../db/client.js';

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
