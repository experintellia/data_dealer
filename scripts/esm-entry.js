// ESM entry point for new Wave 2 modules.
// Add an import here for each new ESM module as they land (#10 state, #11 materializer, etc.).
// Vite bundles this file into dist/scripts/esm-bundle.js (IIFE format).
// A footer in vite.config.js then calls define() for each export so that
// legacy requirejs AMD modules can require() new ESM modules by name.

import { boot } from './boot.js';

export { default as webxdcIdentity } from './webxdc-identity.js';
export const __placeholder = true;
export * as state from './state.js';
export { materialize } from './materializer.js';
export * as clock from './clock.js';
import './devtools.js';
// LocalEngine is exposed as an AMD module via the bridge so Remote.js can
// require('LocalEngine').  The default export is the handler-method object.
export { default as LocalEngine } from './LocalEngine.js';
// Expose boot module (getState, setState) via AMD bridge so e2e tests and
// any future AMD consumers can call require(['boot']).getState().
export * as boot from './boot.js';

// Bring the engine online before any AMD module can call into it.
// boot() returns a Promise that resolves once setUpdateListener has
// replayed the full history. bootstrap.js fetches the promise via the
// AMD bridge (require('boot').getBootPromise()) and gates app.start()
// on its resolution so the UI never sees a partially-replayed state.
// boot() itself runs the synchronous part (freshState + listener
// registration) before returning, so getState() / sendUpdate() are safe
// to call from AMD modules at any point — they just see fresh state
// until replay catches up.
if (typeof webxdc !== 'undefined') {
  boot();
}

