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
| Asset inlining | `assetsInlineLimit: 4096` (explicit) | Files under 4 KB inline as base64; larger ones stay as separate dist files. |
| CSS | Loaded via 4 `<link>` tags in `index.html`; per-file minified by esbuild via `vite-plugin-static-copy` `transform` | Files stay separate (cascade order = `<link>` tag order in `index.html`) so neither index.html nor `esm-entry.ts` need rewiring. ~31% smaller per file. Bundling the four into one `style.[hash].css` would save another ~2 kB of file overhead but requires an index.html rewrite — out of scope. |
| Vendor libs | Bundled into `esm-bundle.js` via Rollup `output.banner` (#192) | Banner runs at global scope (before `'use strict'` + IIFE), so `this.createjs = …` and `global.Scroller = …` patterns bind to `window`. Game code reads them via `globalThis.$`, `globalThis.createjs`, etc. Order: jquery → sprintf → easeljs → tweenjs → soundjs → zynga-animate → zynga-scroller. No separate `<script>` tags or `vendor/` directory in the `.xdc`. |
| Static data | `data/`, `i18n/`, `img/`, fonts copied via `vite-plugin-static-copy`; JSON in `data/` and `i18n/` whitespace-stripped at `closeBundle` by the `minify-static-json` plugin | Source files stay pretty-printed for git diffs; the .xdc ships compacted (`JSON.parse` → `JSON.stringify` w/o indent, ~38% smaller raw). On-disk .xdc savings are smaller (zip already compresses whitespace well) but cold-start `JSON.parse` time scales with character count, not compressed bytes. |
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
- Transitions and FX with EaselJS/TweenJS
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

---

# Network-layer architecture (post-Wave-1 stubs)

## Overview

Wave 1 replaced the original JSON-RPC + SockJS network layer with an
in-process stub stack that keeps every existing `.done()` / `.fail()` call
site intact.  The three new modules are:

| Module | Role |
|---|---|
| `scripts/Remote.js` | Thin shim; delegates `remote.method()` calls to LocalEngine |
| `scripts/LocalEngine.js` | Stub engine; every handler rejects with `"NotImplemented: <name>"` |
| `scripts/Socket.js` | In-process event bus backed by `$(document)` jQuery events |

---

## Boot sequence

```
index.html
  └─ require.js  (data-main: scripts/require.config)
       └─ require(['bootstrap'])
            └─ bootstrap.js
                 1. new Remote(...)          # endPoint arg is ignored by the stub
                 2. remote.addMethod('getToken')
                 3. routie('load')
                      └─ remote.getToken()
                           └─ LocalEngine.getToken()
                                └─ $.Deferred().reject('NotImplemented: getToken')
                           └─ .fail() handler fires
                                ├─ console.error('Error: NotImplemented: getToken')
                                └─ routie('downtime')  →  downtime view rendered
```

`app.start()` (in `app.js`) is never reached in this baseline because the
`remote.getToken()` in the `routie('load')` handler rejects before the asset
loader runs.  Socket initialisation (`app.initSocket`) is therefore also
skipped.

---

## RPC call path: Game.js → Remote → LocalEngine → Deferred

When the game eventually runs (Wave 3+), every RPC call follows the same
path:

```
// e.g. inside Game.js
app.remote.buyPerp(app.token, path, gestalt)
  │
  ├─ Remote.addMethod registered remote['buyPerp'] as:
  │     function() {
  │       var fn = LocalEngine['buyPerp'];
  │       if (typeof fn === 'function') return fn.apply(LocalEngine, arguments);
  │       return $.Deferred().reject('NotImplemented: buyPerp').promise();
  │     }
  │
  └─ LocalEngine.buyPerp(token, path, gestalt)
       └─ returns $.Deferred().reject('NotImplemented: buyPerp').promise()
            │
            ├─ .done() chain → skipped
            └─ .fail() chain → error handled at call site
```

`Remote` accepts (and silently ignores) a second `endpointOverride` argument
to `addMethod` and the `Remote.NEEDS_QUEUE` sentinel passed by legacy call
sites in `app.js`.  No HTTP request is ever issued.

---

## Event flow: LocalEngine → Socket → app.js handlers

When LocalEngine handlers are implemented (Wave 3+) they will push server-
side state changes back to the UI by emitting events through the Socket:

```
LocalEngine.someHandler(...)
  └─ socket.emit('node_ready', { id: ..., result: ... })
       └─ $(document).trigger('node_ready', data)
            └─ listener registered by app.js via socket.on('node_ready', ...)
                 └─ app.game.getById(data.id).trigger('node_ready', [data.result])
```

`Socket.emit(eventName, data)` calls `$(document).trigger(eventName, data)`.
`Socket.on(eventName, handler)` wraps the handler in a `$(document).on()`
listener.  There is no WebSocket, no SockJS, and no server involved.

On construction `Socket` fires `connect` then `established` synchronously
(via `setTimeout(0)`) so that `app.initSocket`'s handshake Deferred resolves
without needing a real server connection.

---

## Where LocalEngine plugs into the boot sequence

`Remote.js` requires `LocalEngine` at module load time:

```javascript
// Remote.js top-level
var LocalEngine = require('LocalEngine');
```

`LocalEngine` is therefore available to every `remote.addMethod(name)` call.
No explicit wiring is needed in `bootstrap.js` or `app.js`.

When a Wave 3 handler is ready, replace the stub in `LocalEngine.js`:

```javascript
// before
LocalEngine['buyPerp'] = function() {
  return $.Deferred().reject('NotImplemented: buyPerp').promise();
};

// after
LocalEngine['buyPerp'] = function(token, path, gestalt) {
  // … real implementation …
  return $.Deferred().resolve({ result: … }).promise();
};
```

No changes to Remote.js, Socket.js, app.js, or bootstrap.js are required.

---

## "Boots-to-broken" baseline

The state after Wave 1 is intentionally broken at the game-start level:

* The app loads, renders no game, and shows the **downtime** view.
* DevTools **Network** tab shows **zero non-localhost requests** during boot.
* DevTools **Console** shows the expected rejection:

  ```
  Error:  NotImplemented: getToken
  Backend made a  bubu, do something!
  ```

This is the correct baseline.  Wave 1's goal was to eliminate all external
network calls while keeping every existing call site in Game.js, app.js, and
bootstrap.js syntactically intact.  Wave 3 issues will replace the stubs one
by one with real client-side handlers.
