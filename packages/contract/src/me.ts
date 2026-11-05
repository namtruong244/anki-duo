import { createRoute, z } from '@hono/zod-openapi';
import { SettingsPatchSchema, SettingsSchema, problemResponse } from './common.js';

export const patchSettingsRoute = createRoute({
  method: 'patch',
  path: '/me/settings',
  summary: 'Update learner settings',
  request: {
    body: { required: true, content: { 'application/json': { schema: SettingsPatchSchema } } },
  },
  responses: {
    200: { description: 'Updated', content: { 'application/json': { schema: SettingsSchema } } },
    422: problemResponse('Error'),
  },
});

export const deleteAccountRoute = createRoute({
  method: 'delete',
  path: '/me',
  summary: 'Delete the account and all its data (FR-030)',
  description: 'Requires a fresh session (signed in within the last 10 minutes).',
  responses: { 204: { description: 'Deleted' }, 403: problemResponse('Error') },
});

export const clientEventRoute = createRoute({
  method: 'post',
  path: '/client-events',
  summary: 'Report client-side errors and sync failures (observability, research R16)',
  request: {
    body: {
      required: true,
      content: {
        'application/json': {
          schema: z.object({
            kind: z.enum(['error', 'sync_failure']),
            message: z.string().max(2000),
            context: z.record(z.string(), z.unknown()).optional(),
          }),
        },
      },
    },
  },
  responses: { 202: { description: 'Accepted' } },
});
