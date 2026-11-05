import type { RouteConfig } from '@hono/zod-openapi';

/** Contract paths are relative to the `/api/v1` server URL. */
export const v1 = <R extends RouteConfig>(route: R): R => ({
  ...route,
  path: `/api/v1${route.path}`,
});
