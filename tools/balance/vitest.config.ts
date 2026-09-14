import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * The balance harness runs under its own config because the root config
 * deliberately scopes the default suite to `src/**` - a multi-hour simulation
 * has no business in `npm test` or CI, and vitest applies that include even to
 * a file named explicitly on the command line.
 *
 *   npx vitest run --config tools/balance/vitest.config.ts
 *
 * No React plugin: the harness is plain TypeScript against the engine, which is
 * required to run headlessly in Node anyway (see docs/ARCHITECTURE.md).
 */
export default defineConfig({
  root: fileURLToPath(new URL('../..', import.meta.url)),
  test: {
    include: ['tools/balance/**/*.test.ts'],
    testTimeout: 3_000_000,
    hookTimeout: 3_000_000,
  },
});
