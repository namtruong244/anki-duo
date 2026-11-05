import { eq } from 'drizzle-orm';
import type { z } from '@hono/zod-openapi';
import type { SettingsPatchSchema, SettingsSchema } from '@anki-duo/contract';
import { schema, type Db } from '../db/client.js';
import { ApiProblem } from '../problem.js';

export type Settings = z.infer<typeof SettingsSchema>;
export type SettingsPatch = z.infer<typeof SettingsPatchSchema>;

export const toSettings = (r: typeof schema.learnerSettings.$inferSelect): Settings => ({
  locale: r.locale as Settings['locale'],
  timeZone: r.timeZone,
  dayStartHour: r.dayStartHour,
  desiredRetention: Number(r.desiredRetention),
  maximumIntervalDays: r.maximumIntervalDays,
  dailyXpGoal: r.dailyXpGoal,
  sessionSize: r.sessionSize,
  soundEnabled: r.soundEnabled,
  motion: r.motion as Settings['motion'],
});

export async function getSettings(db: Db, userId: string): Promise<Settings> {
  const [row] = await db
    .select()
    .from(schema.learnerSettings)
    .where(eq(schema.learnerSettings.userId, userId));
  if (!row) throw new ApiProblem(404, 'not_found', 'Learner settings not found');
  return toSettings(row);
}

/** Changing retention or max interval only affects future reviews; card rows are not touched (FR-004). */
export async function updateSettings(
  db: Db,
  userId: string,
  patch: SettingsPatch,
  now: Date,
): Promise<Settings> {
  const { desiredRetention, ...rest } = patch;
  const [row] = await db
    .update(schema.learnerSettings)
    .set({
      ...rest,
      ...(desiredRetention !== undefined ? { desiredRetention: desiredRetention.toFixed(2) } : {}),
      updatedAt: now,
    })
    .where(eq(schema.learnerSettings.userId, userId))
    .returning();
  if (!row) throw new ApiProblem(404, 'not_found', 'Learner settings not found');
  return toSettings(row);
}
