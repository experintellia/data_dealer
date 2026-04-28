# Contributing to Data Dealer (webxdc port)

## Test infrastructure

Tests live in `tests/` and are run with [vitest](https://vitest.dev/) in a
pure Node context — no browser, no jQuery, no RequireJS globals.

### Running tests locally

```sh
pnpm install        # first time only
pnpm test           # single run
pnpm test:coverage  # single run + coverage report in ./coverage/
```

Tests should complete in under 5 s for the current suite.

### Directory layout

```
tests/
  state/        # state model unit tests  (seed tests land with #10)
  materializer/ # materializer unit tests (seed tests land with #11)
  handlers/     # one file per RPC handler (land alongside each Wave 3 PR)
```

Test files are named `<module>.test.js` and live in the subdirectory that
matches the module under test (e.g. `tests/handlers/buyPowerup.test.js`).

---

## Handler PR requirements (Wave 3, issues #12–#21)

**Every handler-port PR must ship with unit tests.** A PR will not be merged
without them.

Minimum coverage per handler:

| Case | What to test |
|------|-------------|
| Happy path | Normal input produces expected state delta |
| Failure mode | At least one guard condition (e.g. insufficient cash, prerequisite unmet, invalid args) rejects/returns the expected error |

Tests must import the handler as a plain ES module function and call it
directly — no browser globals, no jQuery, no RequireJS `define()` wrappers.

---

## Module portability rule

The `LocalEngine`, state model, and materializer modules **must remain
importable from a Node context.** Concretely:

- Do not use `define(function(require) { … })` (RequireJS AMD) in any module
  that will be unit-tested.
- Do not call `$` (jQuery), `window`, `document`, or other browser-only globals
  at module load time.
- Pure functions of `(state, args, now)` are ideal; keep side effects at the
  boundary, not in the core logic.

If a module currently wraps itself in `define(...)`, extract the core logic
into a plain ES module export and keep the AMD wrapper as a thin shim for the
legacy build only.

---

## CI

A GitHub Actions workflow (`.github/workflows/test.yml`) runs `pnpm install &&
pnpm test` on every push to `main` and on every pull request.  Coverage is
uploaded as a workflow artifact (download from the Actions tab).

### Making the test check required

After the first CI run appears on a PR, a repository admin should enable
**branch protection** on `main`:

1. Go to **Settings → Branches → Add rule** for `main`.
2. Enable **"Require status checks to pass before merging"**.
3. Add the `test` job (it will appear in the autocomplete once it has run once).
4. Optionally enable **"Require branches to be up to date before merging"**.

This ensures a failing test blocks the merge — Claude Code cannot configure
branch protection via file changes, so this step is manual.
