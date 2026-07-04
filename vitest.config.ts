// Standalone Vitest config so the package's unit tests run on their own in the
// exported public repo (github.com/cardanowall/poe-attest), independent of the
// monorepo root config. Collects the colocated `src/**/*.test.ts` files only.
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
  },
});
