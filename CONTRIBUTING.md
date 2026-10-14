# Contributing to Data Dealer (webxdc port)

## Prerequisites

- [pnpm](https://pnpm.io/) 10
- Node.js 22.12+ or 24+ (required by Vite 8 and vite-plugin-static-copy; CI uses Node 22)

`pnpm install` also installs the [lefthook](https://lefthook.dev/) git hooks:
`biome check` on staged JS/TS/CSS files before each commit, `pnpm typecheck` and
`pnpm test` before each push.

## Scripts

| Command | What it does |
|---|---|
| `pnpm dev` | Vite dev server on http://localhost:3000 with a mock `webxdc.js` (`pnpm dev:debug` also loads `preact/debug`) |
| `pnpm build:all` | Both bundles: `data-dealer-hq.xdc` and `data-dealer-casual.xdc` (`build:hq` / `build:casual` build one) |
| `pnpm build:pages` | Standalone browser build in `dist-pages/` (what GitHub Pages serves) |
| `pnpm quantize-assets` | Regenerate `img-casual/` and `icon-casual.png` from `img/` and `icon.png` (needs `pngquant` and `oxipng`) |
| `pnpm test` / `pnpm test:coverage` | Unit tests (vitest), optionally with coverage in `coverage/` |
| `pnpm test:e2e` | Playwright end-to-end tests (Chromium) against the dev server |
| `pnpm typecheck` | `tsc --noEmit` for `scripts/`, `tests/` and `types/`, then for the config files and `tools/` |
| `pnpm lint` / `pnpm lint:fix` | Biome lint + format check / auto-fix |

See the README for what the two bundle variants are.

## Tests

Unit tests are the `*.test.*` / `*.spec.*` files under `tests/` (outside
`tests/e2e/`) and run in plain Node.
`tests/build/build.test.js` runs `pnpm build:all` before checking both
`.xdc` files (delete stale `data-dealer-*.xdc` at the repo root if in doubt).

Playwright specs live in `tests/e2e/`; `pnpm test:e2e` starts `pnpm dev` itself
(reusing a server already on port 3000 outside CI). Install the browser once with
`pnpm exec playwright install chromium`. Set `BUILD_VARIANT=casual` to run
them against the casual assets.

## CI

`.github/workflows/test.yml` runs on pull requests and on pushes to `master`:
Biome, typecheck, unit tests with coverage, both `.xdc` builds (with a
1.9 MB ceiling on `scripts/esm-bundle.js` and a PR comment linking the
artifacts), and the Playwright suite. Pushing a `v*` tag also attaches both
`.xdc` files to a GitHub Release (see `docs/releasing.md`).
`.github/workflows/pages.yml` deploys `pnpm build:pages` to GitHub Pages on
every push to `master`.
