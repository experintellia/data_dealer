// ESM entry point for new Wave 2 modules.
// Add an import here for each new ESM module as they land (#10 state, #11 materializer, etc.).
// Vite bundles this file into dist/scripts/esm-bundle.js (IIFE format).
// A footer in vite.config.js then calls define() for each export so that
// legacy requirejs AMD modules can require() new ESM modules by name.

export { default as webxdcIdentity } from './webxdc-identity.js';
export const __placeholder = true;
export * as state from './state.js';
export { materialize } from './materializer.js';
export * as clock from './clock.js';
import './devtools.js';
// LocalEngine is exposed as an AMD module via the bridge so Remote.js can
// require('LocalEngine').  The default export is the handler-method object.
export { default as LocalEngine } from './LocalEngine.js';
