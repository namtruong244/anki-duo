import { defineConfig } from 'vitest/config';

// Vitest 5 reads projects from the root config (the old vitest.workspace.ts file is gone).
// The edge tests run in the workers pool through apps/edge/vitest.config.ts (pnpm test:edge).
export default defineConfig({
  test: {
    projects: [
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
        oxc: { jsx: { runtime: 'automatic' } },
        test: {
          name: 'int-web',
          include: ['apps/web/tests/**/*.test.{ts,tsx}'],
          environment: 'jsdom',
          setupFiles: ['apps/web/tests/setup.ts'],
        },
      },
    ],
  },
});
