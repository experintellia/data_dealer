# Data Dealer (webxdc port)

[![Tests](https://github.com/experintellia/data_dealer/actions/workflows/test.yml/badge.svg)](https://github.com/experintellia/data_dealer/actions/workflows/test.yml)

## About this fork

This repository is a port of the [Data Dealer](http://datadealer.com) browser game into a [webxdc](https://webxdc.org) mini-app — a self-contained, offline-capable application that runs inside a Delta Chat group.

- **Runs completely offline** — no server, no account, no hosting bills. The entire game runs inside a Delta Chat group as a single `.xdc` file.
- **Playable on phones** — the original layout assumed a desktop screen. Every dialog, the status bar and the game board were rebuilt for touch: full-screen bottom-anchored popups, drag-scrolling item grids, and layouts that hold together down to 375 px (iPhone SE). CI takes screenshots at that viewport on every pull request, so mobile is a tested target rather than a hope.
- **Try it in a browser first** — [experintellia.github.io/data_dealer](https://experintellia.github.io/data_dealer/) runs the same build as a plain web page, no messenger install required. Peer messaging is simulated locally there; the real thing needs Delta Chat.
- **Each chat group is its own game lobby** — share the app into any group and it becomes an isolated game instance. Multiplayer without infrastructure.
- **Your messenger name is your player name** — identity is pulled straight from Delta Chat, no sign-up required. On messengers that implement the experimental webxdc avatar API, peers' profile pictures appear next to their scores in the leaderboard.
- **Milestones land in the chat** — level-ups, completed missions, profile-count milestones and full saint/devil karma post a one-line notice into the group timeline, so the game plays as a conversation and not just a private tab.
- **Take your save with you** — export your progress into the chat as a file and import it back on another device or in another group. An export carries your own progress only, never other players' data.
- **Nothing phones home** — no accounts, no analytics, no ads, no network calls of any kind. The game code contains no `fetch` and no `XMLHttpRequest`; everything is bundled in the `.xdc`.
- **English and German** — the app picks your messenger's language on first start, and you can switch in-game at any time without losing your progress. Both rulesets have also been fleshed out: previously-untranslated item names plus dozens of missing item descriptions written in both languages (localized, not literal), along with a small localization fix.
- **The full game, not a demo** — all original game mechanics are ported: buying/selling data profiles, charging and collecting from perps, karma, powerups, missions, and idle progression (your resources keep ticking even when the app is closed).
- **Two-variant releases** — every release ships an HQ bundle (~14 MiB, bit-exact lossless cartoon art) and a casual bundle (~5.5 MiB, palette-quantized; visually indistinguishable for typical play). Pick whichever your data plan or messenger likes better.
- **Automated builds and a real test suite** — 800+ unit tests plus a Playwright end-to-end suite (including the mobile screenshots) run on every pull request, which also builds both `.xdc` files for download; tagged releases publish both automatically.

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

Build the standalone browser version (what GitHub Pages serves):

    $ npm run build:pages   # dist-pages/ — no .xdc, ships a webxdc stub instead

It builds the HQ assets (lossless sprites): unlike a `.xdc`, which travels
through a chat, the web version is served once and cached, so there is no
bundle-size ceiling to trade quality against.

`.github/workflows/pages.yml` deploys that `dist-pages/` to GitHub Pages on every
push to `master` (repo setting: Settings → Pages → Source = "GitHub Actions").
Since there is no messenger to inject `webxdc.js`, the build ships the
[`@webxdc/vite-plugins`](https://github.com/webxdc/vite-plugins) stub — the
game is fully playable, "Add Peer" opens a second local player in a new tab,
and the dev-tools panel has a close button so it can be dismissed.

The casual variant ships pre-quantized PNGs from [`img-casual/`](./img-casual/) and `icon-casual.png` (committed to the repo). If you change anything in [`img/`](./img/) or `icon.png`, run `npm run quantize-assets` (requires `pngquant` and `oxipng`) and commit the resulting diff.

## Licensing & credits

See [`LICENSE-CODE.txt`](./LICENSE-CODE.txt) (Artistic License 2.0, covering the dd_js fork and the ported dd_app code), [`LICENSE-ASSETS.txt`](./LICENSE-ASSETS.txt) (CC-BY-SA 3.0 Austria, covering dd_rules data, `img/`, `i18n/`, and fonts), and [`CREDITS.txt`](./CREDITS.txt) for the original team and modification notes.
