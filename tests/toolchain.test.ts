// Live canary: this file IS the .test.ts that the discovery contract in
// tests/toolchain.test.js depends on. Without the companion checks in
// the .js file, a regression that drops `.ts` from vitest's `include`
// glob would just silently skip this file — the test count would drop
// by one and nothing would fail. The .js side of the toolchain test
// closes that gap by (a) asserting the glob in vitest.config.js still
// names .ts/.tsx/.mts and (b) asserting this file exists on disk;
// either pre-condition failing produces a loud test failure.
import { describe, expect, it } from 'vitest';

describe('vitest TypeScript discovery (canary)', () => {
  it('discovers .test.ts files', () => {
    expect(1 + 1).toBe(2);
  });
});
