# TypeScript conventions

This document records the conventions agreed in issue #32 (Phase 7 TypeScript
foundation).  Strict mode and full conversion are tracked separately in #147.

---

## Guiding principle

Add type-checking benefits today, without committing to a multi-week
strict-mode lift.  The migration is incremental: new pure modules arrive in
TypeScript, the legacy AMD bundle stays JavaScript until the ESM migration
(#58) unblocks a clean conversion path.

---

## New code: TypeScript by default

All **new pure modules** (state utilities, domain helpers, test scaffolding)
must be written as `.ts` files.  TypeScript's compiler (`tsc --noEmit`) runs
as a required CI check alongside `npm test` so type regressions are caught
immediately.

---

## Migrated pure modules (this PR, issue #32)

| Old name | New name | Notes |
|---|---|---|
| `scripts/clock.js` | `scripts/clock.ts` | Injectable clock for tests |
| `scripts/state.js` | `scripts/state.ts` | `LocalState`, `Delta`, game-value types |
| `scripts/materializer.js` | `scripts/materializer.ts` | `MaterializeResult`, `NodeReadyEvent` |
| `scripts/webxdc-shim.js` | `scripts/webxdc-shim.ts` | Browser dev-mode scaffold |

Import paths in existing JS callers (e.g. `import './state.js'`) need **no
changes**: TypeScript's `moduleResolution: "Bundler"` and Vite's runtime both
resolve `.js` imports to the corresponding `.ts` file when the `.js` source no
longer exists.

---

## Legacy AMD modules — stay JS until #147

The following files are **not touched** until issue #147 (full strict mode) and
issue #58 (ESM migration) are resolved:

| File | Reason |
|---|---|
| `scripts/Game.js` (~5700 LOC) | Requires ESM + strict-mode lift (#147) |
| `scripts/Render.js` (~5250 LOC) | Same |
| `scripts/app.js` | AMD bootstrap; awaits #58 ESM migration |
| `scripts/bootstrap.js` | Same |
| `scripts/Remote.js` | Same |
| `scripts/Socket.js` | Same |

`scripts/LocalEngine.js` is the bridge: it is kept as `.js` with a
`// @ts-check` annotation and JSDoc type references pointing at the types
defined in `scripts/state.ts` and `scripts/materializer.ts`.  Full conversion
to `.ts` can happen incrementally once the AMD bundle is gone.

---

## tsconfig.json — conservative settings

```json
{
  "compilerOptions": {
    "strict": false,
    "checkJs": false,
    "allowJs": true,
    "noEmit": true
  }
}
```

Key decisions:

- **`strict: false`** — `noImplicitAny`, `strictNullChecks`, and the rest of
  the strict family are *#147's job*.  Enabling them now would require
  annotating ~12 000 lines of legacy JS before CI goes green.
- **`checkJs: false`** — plain `.js` files are included in the compilation
  (for IDE resolution) but not type-checked.  Individual files can opt in with
  `// @ts-check` (e.g. `LocalEngine.js`).
- **`allowJs: true`** — lets TypeScript resolve imports across the JS/TS
  boundary so `.ts` modules can import from `.js` modules and vice versa.
- **`moduleResolution: "Bundler"`** — matches Vite's resolution semantics;
  allows `import './foo.js'` to resolve to `foo.ts`.
- **`noEmit: true`** — TypeScript is type-checker only; Vite/esbuild owns
  transpilation.

---

## Strict mode (#147)

Issue #147 will:

1. Flip `strict: true` (enables `noImplicitAny`, `strictNullChecks`, etc.).
2. Flip `allowJs: false` (all source must be TypeScript).
3. Convert `LocalEngine.js` and the remaining AMD modules to `.ts` (depends
   on #58 completing the ESM migration first).

Do **not** enable strict-mode flags in this PR or any PR that targets `main`
before #147 is merged.
