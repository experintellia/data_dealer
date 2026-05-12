// @ts-nocheck — strict-TS quarantine; remove when this file is migrated to TS (issue #147)
/**
 * Regression: bootstrap must call boot() even when the webxdc global is
 * absent. The legacy guard `typeof webxdc !== 'undefined'` skipped boot()
 * entirely on browsers/runtimes without webxdc, which left `_currentState`
 * unseeded and caused the very next getState() call (e.g. getSessionLocale)
 * to throw.
 *
 * The fix is that bootstrap unconditionally invokes boot(); boot() itself
 * already handles a missing webxdc by seeding freshState() with an empty
 * selfAddr and skipping setUpdateListener.
 *
 * This test stubs a minimal DOM (window, document, jQuery) and asserts:
 *   1. After bootstrap evaluates with no webxdc, getBootPromise() is
 *      non-null (boot was called).
 *   2. getState() returns a valid LocalState instead of throwing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('bootstrap — webxdc-absent boot regression', () => {
  let savedWindow, savedDocument, savedJQuery, savedDollar, savedWebxdc, savedUnderscore;

  beforeEach(() => {
    savedWindow = globalThis.window;
    savedDocument = globalThis.document;
    savedJQuery = globalThis.jQuery;
    savedDollar = globalThis.$;
    savedWebxdc = globalThis.webxdc;
    savedUnderscore = globalThis._;

    // Minimal DOM stubs sufficient for bootstrap's body to evaluate.
    const fakeEl = {
      value: 0,
      max: 1,
      textContent: '',
    };
    const fakeJq = () => ({
      html() {
        return fakeJq();
      },
      text() {
        return fakeJq();
      },
      find() {
        return fakeJq();
      },
    });
    fakeJq.when = (...args) => ({
      then(cb) {
        cb(...args);
        return fakeJq();
      },
      fail() {
        return fakeJq();
      },
    });

    globalThis.window = {};
    globalThis.document = {
      getElementById: () => fakeEl,
      querySelector: () => null,
    };
    globalThis.jQuery = fakeJq;
    globalThis.$ = fakeJq;
    // Underscore stub — bootstrap pulls in app.ts which precompiles view
    // templates via `_.template`. The compiled fn is invoked at render time
    // (not at bootstrap-import time), so a no-op factory is sufficient.
    globalThis._ = {
      template() {
        return () => '';
      },
      mixin() {},
      sprintf(t) {
        return String(t);
      },
      toKSNum(n) {
        return String(n);
      },
      numeral() {
        return { format: () => '' };
      },
    };
    globalThis.numeral = () => ({ format: () => '' });
    globalThis.sprintf = (t) => String(t);
    // Critically: NO globalThis.webxdc.
    delete globalThis.webxdc;
  });

  afterEach(() => {
    globalThis.window = savedWindow;
    globalThis.document = savedDocument;
    globalThis.jQuery = savedJQuery;
    globalThis.$ = savedDollar;
    globalThis.webxdc = savedWebxdc;
    globalThis._ = savedUnderscore;
  });

  it('boot() is invoked and getState() does not throw when webxdc is absent', async () => {
    // Reset modules so bootstrap.ts re-evaluates against the freshly-stubbed
    // DOM/globals; without this, an earlier suite's import is reused.
    vi.resetModules();
    // bootstrap's continueStart asynchronously calls app.start() which trips
    // over the stub jQuery; swallow its noisy console output since the boot
    // contract (state seeded) is what we're asserting here.
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});

    await import('../scripts/bootstrap.js');
    const boot = await import('../scripts/boot.js');

    expect(boot.getBootPromise()).not.toBeNull();
    // boot() is synchronous through to _currentState assignment, so getState()
    // must work immediately even before the boot promise resolves.
    const state = boot.getState();
    expect(state).toBeDefined();
    expect(typeof state).toBe('object');

    errSpy.mockRestore();
    infoSpy.mockRestore();
  });
});
