import { OpenAPIHono } from '@hono/zod-openapi';
import { SECURITY, securitySchemes } from './common.js';
import { routes } from './routes.js';

/** Builds the OpenAPI document from every registered route (research R17). */
export function buildOpenApiDocument() {
  const app = new OpenAPIHono();
  app.openAPIRegistry.registerComponent(
    'securitySchemes',
    'sessionCookie',
    securitySchemes.sessionCookie,
  );
  app.openAPIRegistry.registerComponent(
    'securitySchemes',
    'bearerSession',
    securitySchemes.bearerSession,
  );
  for (const route of routes) app.openapi(route, (c) => c.body(null, 501) as never);
  return app.getOpenAPI31Document({
    openapi: '3.1.0',
    info: { title: 'Anki Duo API', version: '1.0.0' },
    servers: [{ url: '/api/v1' }],
    security: SECURITY,
  });
}
