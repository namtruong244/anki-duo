import type { RouteConfig } from '@hono/zod-openapi';
import { patchSettingsRoute } from './me.js';

/** Every route definition, appended story by story. */
export const routes: RouteConfig[] = [patchSettingsRoute];
