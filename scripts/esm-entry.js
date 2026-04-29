// ESM entry point for new Wave 2 modules.
// Add an import here for each new ESM module as they land (#10 state, #11 materializer, etc.).
// esbuild bundles this file into dist/scripts/esm-bundle.js (IIFE format).
// A footer in esbuild.config.js then calls define() for each export so that
// legacy requirejs AMD modules can require() new ESM modules by name.
//
// Example — after #10 lands:
//   export { default as LocalEngine } from './LocalEngine.esm.js';
//
// Until then this file is intentionally empty so the bundle is a no-op.

export const __placeholder = true;
