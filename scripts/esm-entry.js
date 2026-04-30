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

// Bring the engine online before any AMD module can call into it.  Runs
// synchronously: webxdc.js is loaded earlier in index.html so window.webxdc
// is defined, and the messenger replays update history synchronously inside
// setUpdateListener.  Without this, getState() returns null and the first
// loadGame() call throws, taking app.start() with it and tripping the
// `location.href = "/"` reload-on-failure handler in bootstrap.js — which
// was producing the boot loop you were seeing.
if (typeof webxdc !== 'undefined') {
  boot();
}

