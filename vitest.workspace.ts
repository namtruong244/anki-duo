import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
  {
    test: {
      name: 'unit',
      include: ['packages/*/tests/**/*.test.ts'],
      environment: 'node',
    },
  },
  {
    test: {
      name: 'int-api',
      include: ['apps/api/tests/**/*.test.ts'],
      environment: 'node',
      testTimeout: 30_000,
      hookTimeout: 30_000,
    },
  },
  {
    test: {
      name: 'int-web',
      include: ['apps/web/tests/**/*.test.{ts,tsx}'],
      environment: 'jsdom',
      setupFiles: ['apps/web/tests/setup.ts'],
    },
    esbuild: { jsx: 'automatic' },
  },
  // The edge project runs through apps/edge/vitest.config.ts (workers pool).
  'apps/edge/vitest.config.ts',
]);
