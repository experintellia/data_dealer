import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Tests live under tests/ (per #45). New ESM modules are imported directly
    // from Node — no jQuery, no DOM, no requirejs in the test path.
    include: ['tests/**/*.{test,spec}.{js,mjs}'],
    environment: 'node',
  },
});
