// @ts-nocheck — strict-TS quarantine; remove when this file is migrated to TS (issue #147)
// ESM entry point — Vite bundles this into scripts/esm-bundle.js, which
// index.html loads as a plain `<script>` tag after the vendor library
// `<script>` tags.  All the wiring (boot kick-off, UI hand-off,
// devtools hooks) lives in the modules imported here as side effects.

import * as bootMod from './boot.js';
import LocalEngine from './LocalEngine.js';
import appModule from './app.js';
import './devtools.js';

// Test-only shim: the playwright specs reach into engine internals
// through the legacy `require([...], cb)` shape.
if (typeof window !== 'undefined') {
  const testModules = { boot: bootMod, LocalEngine, app: appModule };
  const lookup = (name) => {
    if (!Object.hasOwn(testModules, name)) {
      throw new Error('window.require: unknown module ' + name);
    }
    return testModules[name];
  };
  window.require = (deps, cb, errCb) => {
    if (typeof deps === 'string') return lookup(deps);
    try {
      const resolved = deps.map(lookup);
      if (cb) cb(...resolved);
    } catch (e) {
      if (errCb) errCb(e); else throw e;
    }
  };
}

import './bootstrap.js';
