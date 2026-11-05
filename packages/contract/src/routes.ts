import type { RouteConfig } from '@hono/zod-openapi';
import { patchSettingsRoute } from './me.js';
import { pullRoute } from './sync.js';

/** Every route definition, appended story by story. */
export const routes: RouteConfig[] = [patchSettingsRoute, pullRoute];
