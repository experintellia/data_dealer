# Replay-safety audit (closes #115)

Per-handler verification that every reducer in `scripts/state.js` is **replay-
safe** and **idempotent under self-echo**. Replay-safe = applying the delta
sequence to a fresh state produces the same shape as the live handler. Self-
echo idempotent = applying the same delta twice (own-emit + listener echo) is
a no-op.

After the #120 architectural fix, the rule is: handlers in
`scripts/LocalEngine.js` compute deltas and call `_persistDelta`. The
`setUpdateListener` callback in `scripts/boot.js` is the sole `setState`
site (or `_persistDelta`'s no-webxdc fallback in tests, which IS the
listener-equivalent). So both invariants are now structural — every handler
goes through the same `applyDelta` path twice (once per peer device) and
must converge.

Tests referenced below live in `tests/handlers/listener-echo.test.js` (the
self-echo regression suite added in Phase 1) plus the per-handler suites
already in place (`chargePerp.test.js`, `collect-integrate.test.js`,
`handlers.test.js`).

## Per-handler verification

### `setDisplayName`
Reducer reads `delta.args[0]`. Idempotent: the same display_name applied
twice is a no-op. Tests: `handlers.test.js > setDisplayName`. ✓

### `setLocale`
Reducer reads `delta.locale`. Idempotent: assigns a fixed locale string.
Tests: `state.test.js > applyDelta — setLocale reducer`. ✓

### `setPerpCoordinates`
Reducer reads `delta.args[0]` (the updates array) and recomputes the
nodes map. Idempotent: applying the same coordinates twice produces the
same nodes array. Tests: `handlers.test.js > setPerpCoordinates`. ✓

### `markTokenSeen`
Reducer reads `delta.args[0]` (gestalt). Idempotent: the seen-map gates
on `seen[gestalt]` so the second apply is a literal no-op (returns the
same `tokens_seen` reference). Tests: `state.test.js > applyDelta —
markTokenSeen reducer`. ✓

### `dismissMissionBriefing`
Same shape as `markTokenSeen` — idempotent gate on `seen[gestalt]`.
Tests: `state.test.js > applyDelta — dismissMissionBriefing reducer`. ✓

### `buyKarma`
Reducer applies `delta.result.game_values` via `Object.assign({}, gv,
delta.result.game_values)` — full snapshot, idempotent under self-echo.
Tests: `handlers.test.js > buyKarma` plus `listener-echo.test.js >
buyKarma — listener echo idempotence`. ✓

### `buyPowerup` / `sellPowerup` / `buySlots`
All three share `_nodeGvReducer`, which patches the matching node's
`instance_data` and merges `game_values` from the snapshot. Both
operations are idempotent (replacing instance_data with the same payload
is a no-op; merging the same game_values is a no-op). Tests:
`handlers.test.js > buyPowerup/sellPowerup/buySlots` plus the three
echo cases in `listener-echo.test.js`. ✓

### `buyPerp`
Reducer dedups by `full_path` before appending to `nodes`, dedups
`db_queue` by `collect_id`, applies `r.game_values` snapshot. The
`node_counter` field is now sourced from `r.node_counter` (the
post-mutation snapshot the handler emits) rather than incrementally
bumped, so listener echo no longer drifts the counter. Tests:
`handlers.test.js > buyPerp` plus `listener-echo.test.js > buyPerp —
listener echo idempotence`. ✓

### `chargePerp`
Reducer prefers the full `r.game_values` snapshot (Phase 2 of #120, also
the canonical fix for #119's tactical patch). The legacy incremental
form (`cashDelta`, `xpInc`) is preserved as a fallback so deltas
persisted before this PR replay correctly on cold start. The
`nodes_charging` push is idempotent: the reducer first filters out any
entry with the same path before concatenating the new chargeEntry, so
echo doesn't double-push. Tests: `chargePerp.test.js` plus
`listener-echo.test.js > chargePerp`. ✓

### `collectPerp`
Reducer:
- Strips `nodes_collect` by path (idempotent — second filter on the same
  path is a no-op).
- **Now also strips `nodes_charging` by path** — closes #114. Without
  this, replay-from-zero left the orphan charging entry, and the next
  `materialize()` re-promoted it to `nodes_collect`, making the perp
  re-collectable after reload.
- Applies `r.game_values` snapshot.
- Dedups `db_queue` by `collect_id` before appending the new entry.
- Replaces the matching `nodes` entry's `instance_data.amount` for
  TokenPerp updates (idempotent).

Tests: `collect-integrate.test.js` (including the unskipped
`collectPerp — replay from zero leaves no orphan nodes_charging` block)
plus `listener-echo.test.js > collectPerp`. ✓

### `integrateCollected`
Reducer:
- Strips `db_queue` by `collect_id` (idempotent).
- Records `collect_id` in `integrated_ids` (gated by `dup` flag handler-
  side; the reducer's boolean-OR is idempotent).
- Applies `r.game_values` snapshot.
- Patches `nodes` from `r.nodes` (a position-by-`full_path` patch); also
  appends fresh TokenPerp nodes for first-time integrations, gated by
  `existingPaths` membership so the second apply is a no-op.

Tests: `collect-integrate.test.js` (multi-handler full-flow + replay-from-
zero cases) plus `listener-echo.test.js > integrateCollected`. ✓

### `loadGame` (special)
Not delta-emitting. Runs the materializer once and seeds mission_goals
lazily for active missions. Calls `setState(seededState)` directly —
this is materializer-driven state, not a delta mutation, and is
allowed under the architectural rule (the `setState` regression guard
in `tests/build/handler-state-mutation.test.js` excludes `loadGame`).

## Outstanding follow-ups

- None blocking.
- The runtime `setState` guard described in #120 Phase 3 is intentionally
  not added — the static grep guard from Phase 6
  (`tests/build/handler-state-mutation.test.js`) is more reliable than a
  runtime warning and avoids noise in materializer-driven paths.
