// ESM entry point — Vite bundles this into scripts/esm-bundle.js, which
// index.html loads as a plain `<script>` tag after the vendor library
// `<script>` tags.  All the wiring (boot kick-off, UI hand-off,
// devtools hooks) lives in the modules imported here as side effects.

import * as bootMod from './boot.js';
import LocalEngine from './LocalEngine.js';
import appModule from './app.js';
import './devtools.js';

// Tiny test-access hook.  The existing playwright e2e specs reach
// into engine internals through `window.require(['LocalEngine'], cb)`
// — a shape they inherited from the AMD era.  This is NOT a generic
// AMD loader (no module registration, no script fetching, no
// transitive dep walking) — it just exposes a fixed set of internal
// modules under their well-known names.  ~20 LOC vs the ~40 KB AMD
// runtime it replaces, so the bundle is still measurably smaller.
if (typeof window !== 'undefined') {
  const testModules = {
    boot: bootMod,
    LocalEngine: LocalEngine,
    app: appModule,
  };
  window.require = function(deps, cb, errCb) {
    if (typeof deps === 'string') {
      if (deps in testModules) return testModules[deps];
      throw new Error('window.require: unknown module ' + deps);
    }
    try {
      const resolved = deps.map(function(d) {
        if (!(d in testModules)) throw new Error('window.require: unknown module ' + d);
        return testModules[d];
      });
      if (cb) cb.apply(null, resolved);
    } catch (e) {
      if (errCb) errCb(e); else throw e;
    }
  };
}

import './bootstrap.js';
