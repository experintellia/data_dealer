// ESM entry point — Vite bundles this into scripts/esm-bundle.js, which
// index.html loads as a plain `<script>` tag after the vendor library
// `<script>` tags.  All the wiring (boot kick-off, UI hand-off,
// devtools hooks) lives in the modules imported here as side effects.

import LocalEngine from './LocalEngine.js';
import appModule from './app.js';
import * as bootMod from './boot.js';
import './devtools.js';

type TestRequire = {
  (name: string): unknown;
  (deps: string[], cb?: (...mods: unknown[]) => void, errCb?: (err: unknown) => void): void;
};

// Test-only shim: the playwright specs reach into engine internals
// through the legacy `require([...], cb)` shape.
if (typeof window !== 'undefined') {
  const testModules: Record<string, unknown> = { boot: bootMod, LocalEngine, app: appModule };
  const lookup = (name: string): unknown => {
    if (!Object.prototype.hasOwnProperty.call(testModules, name)) {
      throw new Error('window.require: unknown module ' + name);
    }
    return testModules[name];
  };
  const reqFn: TestRequire = ((
    deps: string | string[],
    cb?: (...mods: unknown[]) => void,
    errCb?: (err: unknown) => void
  ): unknown => {
    if (typeof deps === 'string') return lookup(deps);
    try {
      const resolved = deps.map(lookup);
      if (cb) cb(...resolved);
    } catch (e) {
      if (errCb) errCb(e);
      else throw e;
    }
    return undefined;
  }) as TestRequire;
  // window.require collides with Node's `Require` type from @types/node;
  // the playwright shim only needs the `(name) => mod` and `(deps, cb)`
  // shapes, so cast through `unknown` to install our narrower function.
  (window as unknown as { require: TestRequire }).require = reqFn;
}

import './bootstrap.js';
