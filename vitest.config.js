import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.{test,spec}.{js,mjs,ts,tsx,mts}'],
    // Playwright e2e specs share the .spec.ts suffix but use the @playwright/test
    // runner — keep them out of vitest's collection.
    exclude: ['node_modules/**', 'dist/**', 'tests/e2e/**'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      reportsDirectory: './coverage',
    },
  },
});
