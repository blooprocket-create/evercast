import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    target: 'es2022',
    sourcemap: true,
  },
  test: {
    // Every unit test lives beside its source under `src/`. Scoping the default
    // suite there keeps `tools/` out of `npm test` - the balance harness in
    // `tools/balance/` is a vitest file only because vitest is the one TypeScript
    // runner this repo has, and a multi-hour simulation has no business in CI.
    // Run it by naming it: `npx vitest run tools/balance/sweep.test.ts`.
    include: ['src/**/*.{test,spec}.ts?(x)'],
  },
});
