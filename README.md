# Data Dealer (webxdc port)

[![Tests](https://github.com/experintellia/data_dealer/actions/workflows/test.yml/badge.svg)](https://github.com/experintellia/data_dealer/actions/workflows/test.yml)

## About this fork

This repository is a port of the [Data Dealer](http://datadealer.com) browser game into a [webxdc](https://webxdc.org) mini-app — a self-contained, offline-capable application that runs inside a Delta Chat group.

- **Runs completely offline** — no server, no account, no hosting bills. The entire game runs inside a Delta Chat group as a single `.xdc` file.
- **Each chat group is its own game lobby** — share the app into any group and it becomes an isolated game instance. Multiplayer without infrastructure.
- **Your messenger name is your player name** — identity is pulled straight from Delta Chat, no sign-up required.
- **English and German** — switch languages in-game at any time without losing your progress.
- **The full game, not a demo** — all original game mechanics are ported: buying/selling data profiles, charging and collecting from perps, karma, powerups, missions, and idle progression (your resources keep ticking even when the app is closed).
- **Automated builds** — every pull request builds and tests the `.xdc` file; tagged releases publish it automatically.

The port fuses three of the original repositories:

- [`datadealer/dd_js`](https://github.com/datadealer/dd_js) — the original frontend (this fork's starting point).
- [`datadealer/dd_rules`](https://github.com/datadealer/dd_rules) — game data (rulesets, default game state). Vendored under [`data/`](./data/).
- [`datadealer/dd_app`](https://github.com/datadealer/dd_app) — the original Python backend, ported into in-browser JavaScript so the game runs without a server.

> webxdc's per-chat sandbox model is almost a better fit for what Data Dealer was trying to be than what they actually built. Their planned multiplayer needed a server, social login, friend graphs — all of which evaporated when the company stopped paying hosting bills. webxdc gives you "every chat group is a game lobby" essentially for free, and there's no service to keep alive. The original architecture is the reason it died; webxdc's architecture is the reason a successor wouldn't.

Planning for this port was done with [Claude](https://www.anthropic.com/claude).

## Development

Install dependencies:

    $ npm install

Start the dev server (with webxdc shim):

    $ npm run dev

Run tests:

    $ npm test

Build the `.xdc` file:

    $ npm run build

## Licensing & credits

See [`LICENSE-CODE.txt`](./LICENSE-CODE.txt) (Artistic License 2.0, covering the dd_js fork and the ported dd_app code), [`LICENSE-ASSETS.txt`](./LICENSE-ASSETS.txt) (CC-BY-SA 3.0 Austria, covering dd_rules data, `img/`, `i18n/`, and fonts), and [`CREDITS.txt`](./CREDITS.txt) for the original team and modification notes.
