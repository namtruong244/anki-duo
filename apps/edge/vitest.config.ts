import { defineConfig } from 'vitest/config';
import { cloudflareTest } from '@cloudflare/vitest-pool-workers';

// Default: run inside workerd. EDGE_POOL=node runs the same tests in Node, for hosts where
// workerd cannot start (e.g. glibc < 2.35). The Worker only uses standard fetch APIs.
const inNode = process.env.EDGE_POOL === 'node';

export default defineConfig({
  plugins: inNode ? [] : [cloudflareTest({ wrangler: { configPath: './wrangler.jsonc' } })],
  test: { name: 'edge', include: ['tests/**/*.test.ts'], passWithNoTests: true },
});
