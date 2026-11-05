import { createRoute } from '@hono/zod-openapi';
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
