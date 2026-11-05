import type { RouteConfig } from '@hono/zod-openapi';
import { deckRoutes } from './decks.js';
import { exportRoutes } from './export.js';
import { mediaRoutes } from './media.js';
import { patchSettingsRoute } from './me.js';
import { pullRoute, pushRoute } from './sync.js';

/** Every route definition, appended story by story. */
export const routes: RouteConfig[] = [
  patchSettingsRoute,
  pullRoute,
  pushRoute,
  ...deckRoutes,
  ...mediaRoutes,
  ...exportRoutes,
];
