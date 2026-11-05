import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig({
  test: {
    name: 'edge',
    include: ['tests/**/*.test.ts'],
    passWithNoTests: true,
    poolOptions: { workers: { wrangler: { configPath: './wrangler.jsonc' } } },
  },
});
