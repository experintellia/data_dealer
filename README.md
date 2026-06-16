# Data Dealer (webxdc port)

[![Tests](https://github.com/experintellia/data_dealer/actions/workflows/test.yml/badge.svg)](https://github.com/experintellia/data_dealer/actions/workflows/test.yml)

## About this fork

This repository is a port of the [Data Dealer](http://datadealer.com) browser game into a [webxdc](https://webxdc.org) mini-app — a self-contained, offline-capable application that runs inside a Delta Chat group.

- **Runs completely offline** — no server, no account, no hosting bills. The entire game runs inside a Delta Chat group as a single `.xdc` file.
- **Each chat group is its own game lobby** — share the app into any group and it becomes an isolated game instance. Multiplayer without infrastructure.
- **Your messenger name is your player name** — identity is pulled straight from Delta Chat, no sign-up required.
- **English and German** — switch languages in-game at any time without losing your progress. The English ruleset has also been tidied up a little: some previously-untranslated item names and copy filled in, plus a small localization fix.
- **The full game, not a demo** — all original game mechanics are ported: buying/selling data profiles, charging and collecting from perps, karma, powerups, missions, and idle progression (your resources keep ticking even when the app is closed).
- **Two-variant releases** — every release ships an HQ bundle (~14 MiB, bit-exact lossless cartoon art) and a casual bundle (~5.5 MiB, palette-quantized; visually indistinguishable for typical play). Pick whichever your data plan or messenger likes better.
- **Automated builds** — every pull request builds and tests both `.xdc` files; tagged releases publish both automatically.

The port fuses three of the original repositories:

- [`datadealer/dd_js`](https://github.com/datadealer/dd_js) — the original frontend (this fork's starting point).
- [`datadealer/dd_rules`](https://github.com/datadealer/dd_rules) — game data (rulesets, default game state). Vendored under [`data/`](./data/).
- [`datadealer/dd_app`](https://github.com/datadealer/dd_app) — the original Python backend, ported into in-browser JavaScript so the game runs without a server.

> webxdc's per-chat sandbox model is almost a better fit for what Data Dealer was trying to be than what they actually built. Their planned multiplayer needed a server, social login, friend graphs — all of which evaporated when the company stopped paying hosting bills. webxdc gives you "every chat group is a game lobby" essentially for free, and there's no service to keep alive. The original architecture is the reason it died; webxdc's architecture is the reason a successor wouldn't.

Planning and implementation of this port was done with [Claude](https://www.anthropic.com/claude).

## Development

Install dependencies:

    $ npm install

Start the dev server (with webxdc shim):

    $ npm run dev

Run tests:

    $ npm test

Build the `.xdc` files:

    $ npm run build:all       # both: data-dealer-hq.xdc + data-dealer-casual.xdc
    $ npm run build:hq        # HQ only — bit-exact lossless pixels
    $ npm run build:casual    # casual only — pre-quantized assets

The casual variant ships pre-quantized PNGs from [`img-casual/`](./img-casual/) and `icon-casual.png` (committed to the repo). If you change anything in [`img/`](./img/) or `icon.png`, run `npm run quantize-assets` (requires `pngquant` and `oxipng`) and commit the resulting diff.

## Licensing & credits

See [`LICENSE-CODE.txt`](./LICENSE-CODE.txt) (Artistic License 2.0, covering the dd_js fork and the ported dd_app code), [`LICENSE-ASSETS.txt`](./LICENSE-ASSETS.txt) (CC-BY-SA 3.0 Austria, covering dd_rules data, `img/`, `i18n/`, and fonts), and [`CREDITS.txt`](./CREDITS.txt) for the original team and modification notes.
