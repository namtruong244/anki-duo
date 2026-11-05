import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { createTestDb } from '../helpers/db.js';
import { testDeps } from '../helpers/app.js';

describe('error handling', () => {
  it('unknown routes under /api/v1 are problem+json not_found', async () => {
    const t = await createTestDb();
    const app = createApp(testDeps(t.db));
    const res = await app.request('/api/nope', { headers: { 'x-origin-secret': 'test-origin' } });
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toContain('application/problem+json');
    expect(await res.json()).toMatchObject({ code: 'not_found', status: 404 });
    await t.close();
  });

  it('adds an x-request-id header', async () => {
    const t = await createTestDb();
    const app = createApp(testDeps(t.db));
    const res = await app.request('/api/health', { headers: { 'x-origin-secret': 'test-origin' } });
    expect(res.headers.get('x-request-id')).toMatch(/[0-9a-f-]{8,}/);
    await t.close();
  });
});
