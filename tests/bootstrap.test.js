// @ts-nocheck — strict-TS quarantine; remove when this file is migrated to TS (issue #147)
/**
 * Regression: bootstrap.ts must invoke boot() even when the webxdc global
 * is absent. The legacy guard `typeof webxdc !== 'undefined'` skipped boot()
 * entirely on browsers/runtimes without webxdc, which left `_currentState`
 * unseeded and caused the very next getState() call (e.g. from
 * getSessionLocale during continueStart) to throw.
 *
 * Verified at two levels:
 *   1. Source-level: the legacy `if (typeof webxdc !== 'undefined') boot()`
 *      guard is gone from bootstrap.ts — it now calls boot() unconditionally.
 *      A literal source-text assertion catches a regression that the test
 *      pipeline cannot exercise end-to-end (bootstrap.ts pulls in the whole
 *      app/Render factory chain via app.ts and is not unit-testable in node).
 *   2. Unit-level: boot() invoked with no webxdc global seeds a valid state
 *      synchronously so getState() never throws. Uses vi.resetModules() so
 *      the assertion is order-independent (passes whether or not earlier
 *      tests in the run already called boot() with a real selfAddr).
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('bootstrap — webxdc-absent boot regression', () => {
  beforeEach(() => {
    // Drop the cached boot.ts module so this test always starts from a
    // fresh _currentState / _bootPromise. Without this, the assertion is
    // order-dependent — `vitest run tests/bootstrap.test.js` alone would
    // see no prior boot() and could spuriously pass for the wrong reason.
    vi.resetModules();
  });

  it('bootstrap.ts no longer guards boot() behind a webxdc check', () => {
    const src = readFileSync(resolve(__dirname, '../scripts/bootstrap.ts'), 'utf8');
    // The legacy guard pattern that this fix removed.
    expect(src).not.toMatch(
      /if\s*\(\s*typeof\s+webxdc\s*!==\s*['"]undefined['"]\s*\)\s*\{?\s*boot\(/
    );
    // And boot() must still be called unconditionally inside the
    // window/document feature-detect block.
    expect(src).toMatch(/\bboot\(\s*\)/);
  });

  it('boot() seeds state synchronously when webxdc is undefined', async () => {
    // Re-import boot from a fresh module graph (vi.resetModules above
    // dropped the cache). With no webxdc global, boot() must still seed
    // state so the immediate getState() call does not throw.
    const fresh = await import('../scripts/boot.js');
    fresh.boot({ selfAddr: '' });
    const state = fresh.getState();
    expect(state).toBeDefined();
    expect(typeof state).toBe('object');
    expect(state).toHaveProperty('addr');
    expect(state).toHaveProperty('schema_version');
  });
});
