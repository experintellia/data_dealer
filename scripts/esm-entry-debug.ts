// Debug entry — used only when running `pnpm dev:debug` (which sets
// PREACT_DEBUG=1, picked up by `bundleEsmDev` in vite.config.js).
//
// Imports `preact/debug` BEFORE the normal entry so its hooks are
// installed before any component renders.  Production builds always
// enter via `esm-entry.ts`; this file is never referenced from the
// `vite build` input, so `preact/debug` cannot reach the shipped .xdc.

import 'preact/debug';
import './esm-entry.js';
