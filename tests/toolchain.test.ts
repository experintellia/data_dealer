// Smoke test: confirms vitest's `include` glob picks up `.test.ts` files.
// Companion to tests/toolchain.test.js — without this assertion, a regression
// in vitest.config.js that drops the .ts extension would go unnoticed.
import { describe, expect, it } from 'vitest';

describe('vitest TypeScript discovery', () => {
  it('discovers .test.ts files', () => {
    expect(1 + 1).toBe(2);
  });
});
