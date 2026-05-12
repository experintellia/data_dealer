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
  it('runs from a .ts source file (not a .js rename)', () => {
    // The reviewer's defence-in-depth nit: 1+1===2 would pass even if
    // someone renamed this to .test.js. Anchor the assertion on the
    // module path so the test only passes when vitest is actually
    // loading a .ts file.
    expect(import.meta.url).toMatch(/\.test\.ts(\?|$)/);
  });

  it('uses TypeScript-only syntax that would error in a plain .js loader', () => {
    // `as const` is a TS-only narrowing; the test file is compiled by
    // vitest's esbuild loader. If a future change disables the TS
    // loader for tests (e.g. drops the include extension), esbuild
    // never gets a chance to strip the cast and the test fails to
    // parse.
    const literal = [1, 2] as const;
    expect(literal.length).toBe(2);
  });
});
