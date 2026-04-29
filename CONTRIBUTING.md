# Contributing to Data Dealer (webxdc port)

## Prerequisites

- [pnpm](https://pnpm.io/) ≥ 9
- Node.js ≥ 18

## Quick start

```bash
pnpm install
pnpm build    # produces dist/
pnpm test     # runs vitest (zero tests until #45 / #10 / #11 land)
```

To open the game locally:

```bash
pnpm build
cd dist && python3 -m http.server 8080
# open http://localhost:8080
```

Expected result: the page loads but the console shows
`NotImplemented: getToken` (the "boots-to-broken" state from issue #9).
No Bower, no Grunt, no RequireJS optimiser is involved anywhere.

## Dev server (live-reload)

```bash
pnpm dev     # esbuild serve on http://localhost:8000
```

This serves `dist/` and rebuilds the ESM bundle on change.
Legacy AMD files are served as static copies — no hot-reload for those yet.

## Building the webxdc archive

```bash
pnpm build-xdc    # runs build then zips dist/ into data-dealer.xdc
```

The `.xdc` file can be sent as an attachment in Delta Chat.

## Project layout

```
scripts/          AMD source (legacy, unchanged until #58)
  Game.js         5 669-line main game loop — DO NOT TOUCH in this phase
  Render.js       5 242-line renderer — DO NOT TOUCH in this phase
  LocalEngine.js  stub RPC back-end; will be filled by Wave 2 issues
  esm-entry.js    ESM bundle entry — add imports here as #10/#11 land
vendor/           Vendored runtime libs (committed; see below)
tests/            Vitest test files (new ESM modules only)
esbuild.config.js Build + dev-server script
vitest.config.js  Test runner config
```

## Adding a new ESM module

1. Create your module as a plain ESM file, e.g. `scripts/state.js`.
2. Add a named export to `scripts/esm-entry.js`:
   ```js
   export { default as state } from './state.js';
   ```
3. `pnpm build` bundles it into `dist/scripts/esm-bundle.js`.
4. Add a script tag in `index.html` **after** `vendor/requirejs.js`:
   ```html
   <script src="vendor/requirejs.js" data-main="scripts/require.config"></script>
   <script src="scripts/esm-bundle.js"></script>  <!-- after requirejs -->
   ```
5. The AMD bridge in `esbuild.config.js` calls
   `define('state', [], () => stateModule)` so legacy requirejs code
   can `require('state')` without any changes.

## AMD ↔ ESM bridge

Legacy code (Game.js, Render.js, app.js, bootstrap.js, …) runs under
RequireJS and uses `define()` / `require()`. New Wave 2 modules are
written as standard ESM.

The bridge works like this:

1. **esbuild** bundles `scripts/esm-entry.js` into an IIFE that sets
   `window.__DD = { moduleName: defaultExport, … }`.
2. A footer appended by `esbuild.config.js` loops over `__DD` and calls
   `define(name, [], () => __DD[name])` for each key.
3. `dist/index.html` loads `esm-bundle.js` **after** `vendor/requirejs.js`
   so that `window.define` is available when the bridge footer runs.

**Load order is critical:** `esm-bundle.js` must come after `requirejs.js`
in the HTML. The footer checks `typeof define === 'function'` — if requirejs
hasn't run yet, the check fails silently and no modules are registered.

This means AMD code can `require('LocalEngine')` and transparently
receive the ESM default export — no changes to legacy source needed.

## Vendor libs

`vendor/` is committed to the repo. It contains pinned copies of the
runtime libs the legacy AMD code loads via RequireJS.

To regenerate `vendor/` (e.g. after a version upgrade):

```bash
node scripts/vendor-install.js
```

### Version notes

Most libs are sourced from npm at the latest available version.
Where the original bower.json pinned ancient commits or versions that
are no longer on npm, a compatibility stub was written in-tree:

| File | Source | Note |
|------|--------|------|
| `routie.js` | in-tree stub | API-compatible with joestrong/routie 0.3.2 |
| `tpl.js` | in-tree impl | Uses `text` + `underscore`, same API as dawsontoth/requirejs-tpl |
| `zynga-animate.js` | in-tree stub | Zynga scroller Animate.js (commit 7d460ea) |
| `zynga-scroller.js` | in-tree stub | Zynga Scroller.js (commit dadd850) |
| `jquery-mobile.js` | in-tree stub | jQM 1.3.2; only used post-getToken |
| `native-console.js` | in-tree stub | No-op; modern browsers always have console |

If internet access is available, replace the stubs with their original
pinned versions using the URLs documented in `scripts/vendor-install.js`.

## Out of scope in this PR

- Converting `Game.js` / `Render.js` / AMD modules to ESM → issue #58
- TypeScript adoption → issue #32
- Biome lint/format → issue #33
- CI workflow for `.xdc` builds → issue #27
