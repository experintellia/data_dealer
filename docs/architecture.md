# Architecture

## Build pipeline

`vite build` rolls every TypeScript module under `scripts/` (entry:
`scripts/esm-entry.ts`) into a single iife at `dist/scripts/esm-bundle.js`.
The legacy AMD layer is gone (#58); strict TS (#147) gives Rollup enough
ESM signal to tree-shake unused exports.

| Concern | Setting (`vite.config.js → build.*`) | Notes |
|---|---|---|
| Bundle shape | `rollupOptions.input = 'scripts/esm-entry.js'`, `output.format = 'iife'`, `output.name = '__DD'` | Single `<script defer>` in `index.html`. iife (not esm) so the .xdc loads without import-map plumbing. |
| Minification | `minify: 'esbuild'` (explicit) | Vite's default; pinned so a future Vite major can't silently flip it off. |
| Tree-shaking | Rollup default for ESM input | Verify after a bundle-affecting change: add an unused export to a small module, build, `unzip -p data-dealer-hq.xdc scripts/esm-bundle.js \| grep` — should be absent. |
| Sourcemaps | `sourcemap: !isRelease` | `BUILD_RELEASE=1` env var (set by CI on tag builds) strips `.map` from the .xdc. Default builds keep them so PR-attached .xdc artifacts are debuggable. |
| CSS | Loaded via 4 `<link>` tags in `index.html`; per-file minified by esbuild via `vite-plugin-static-copy` `transform` | Files stay separate (cascade order = `<link>` tag order in `index.html`) so neither index.html nor `esm-entry.ts` need rewiring. ~31% smaller per file. Bundling the four into one `style.[hash].css` would save another ~2 kB of file overhead but requires an index.html rewrite — out of scope. |
| Vendor libs | Bundled into `esm-bundle.js` via Rollup `output.banner` (#192) | Banner runs at global scope (before `'use strict'` + IIFE), so `this.createjs = …` and `global.Scroller = …` patterns bind to `window`. Game code reads them via `globalThis.$`, `globalThis.createjs`, etc. Order: jquery → sprintf → tweenjs → zynga-animate → zynga-scroller (tweenjs is the standalone CreateJS build with its own `Ticker`; EaselJS/SoundJS are not shipped). No separate `<script>` tags or `vendor/` directory in the `.xdc`. |
| Static data | `img/`, fonts and license files copied via `vite-plugin-static-copy`; `data/` and `i18n/` JSON is `import`ed into `esm-bundle.js` (Vite's JSON plugin emits it compact) | Neither directory ships in the `.xdc` — nothing fetches them at runtime. Their CC BY-SA 3.0 AT notice ships as `LICENSE-ASSETS.txt` + `CREDITS.txt`. |
| `.xdc` packaging | `@webxdc/vite-plugins` `buildXDC` (last plugin) | Zips `dist/` to `data-dealer-{hq,casual}.xdc`. |

CI (`.github/workflows/test.yml`) prints the post-build `scripts/esm-bundle.js`
byte count on every PR / dispatch run and surfaces it in the sticky
`xdc-artifact` comment alongside the .xdc downloads. Tag builds set
`BUILD_RELEASE=1` so the released .xdc has no sourcemap.

Implemented in #192. Sequenced after #58 (AMD → ESM) and #147 (strict TS)
made real bundling possible; landed before Phase 8 mobile (#80) and the
Preact dialog refactor so both have a clean bundle baseline to measure against.

## Key frontend modules

#### `scripts/app.js`
- Low-level API
- Registers templates and backend calls
- Handles template rendering

#### `scripts/bootstrap.js`
- Asset loading and boot sequence
- Token validation and session init

#### `scripts/Game.js`
- Game controller
- Game logic and workflows
- Tree-like node structure of controller nodes
- Invokes rendering and handles game-side events

#### `scripts/Render.js`
- Hybrid HTML/Canvas render engine
- DOM manipulation via jQuery/VanillaJS
- Transitions and FX with TweenJS
- UI-side event handling, feeding events back to Game

#### `scripts/LocalEngine.js`
- All game handler implementations (buyPerp, chargePerp, collectPerp, buyKarma, etc.)
- Ported from the original Python dd_app backend

#### `scripts/state.js`
- Immutable state model; rebuilt by replaying `webxdc.sendUpdate` history

#### `scripts/materializer.js`
- Idle-progression system: AP regeneration and charge completion as a pure function of (state, now)

## Sprites and game data

Sprite files (`sprite-001.png`, `sprite-002.png`, …) for characters and game elements are in `img/`. Sprite-sheet coordinates are defined in the vendored `dd_rules` data under `data/`.
