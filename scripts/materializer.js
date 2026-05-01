// Idle-progression materializer for the webxdc port of Data Dealer.
//
// Timers don't survive app close; state stores immutable timestamps and
// progress is a pure function of (state, now) materialized lazily on read.
//
// Source authority for each rule: docs/async-map.md.

// ── materialize ────────────────────────────────────────────────────────────
/**
 * Apply all time-based progression rules to `state` up to clock value `now`.
 *
 * @param {object} state  - Immutable game-state snapshot.
 *   Relevant fields (all optional; missing fields are treated as empty/absent):
 *     nodes_charging: Array<{
 *       path: string,
 *       result: object,
 *       charge_start: number,   // epoch-ms
 *       charge_end: number,     // epoch-ms — gate for collection
 *       game_id: string,        // needed for node_ready event id field
 *       game_type: string       // needed for node_ready event type field
 *     }>
 *     nodes_collect:  Array<{ path: string, result: object }>
 *     game_values: {
 *       ap_snapshot:    number,  // AP at time of last snapshot
 *       ap_update:      number,  // epoch-ms of last snapshot
 *       ap_inc_value:   number,  // AP gained per regen tick
 *       ap_inc_interval:number,  // ms between regen ticks
 *       ap_max:         number   // AP ceiling
 *     }
 *   NOTE: nodes_charging entries in the port must carry game_id and game_type
 *   (not in the original Mongo schema) so the materializer can build the
 *   node_ready payload without a second nodes lookup.
 *
 * @param {number} now  - Current wall-clock epoch-ms supplied by the caller.
 *                        Never call Date.now() inside this function.
 *
 * @returns {{ state: object, events: Array }}
 *   state  — New state object (shallow-cloned; input is never mutated).
 *             Completed charges are moved from nodes_charging to nodes_collect.
 *             AP snapshot is advanced to `now`.
 *   events — Synthetic socket events in temporal order (earliest charge_end
 *             first).  Each entry: { ev: 'node_ready', pl: { id, type, path,
 *             result } }.  Shape matches docs/socket-events.md §node_ready.
 *             Events represent transitions that occurred in *this* call only;
 *             a second call with the same `now` emits no events (idempotent
 *             state, empty event array).
 */
function materialize(state, now) {
  var events = [];

  // ── Rule 1: chargePerpReady (docs/async-map.md §1) ──────────────────────
  // For every nodes_charging entry where now >= charge_end:
  //   • remove from nodes_charging
  //   • append to nodes_collect (deduplicated by path)
  //   • push a node_ready event
  //
  // Bounded accumulation: each charge is discrete and never auto-restarts,
  // so no cap is needed — we just move every completed entry.
  var charging = state.nodes_charging || [];
  var collect = (state.nodes_collect || []).slice();

  // Build a path-set for O(1) duplicate detection.
  var inCollect = Object.create(null);
  for (var i = 0; i < collect.length; i++) {
    inCollect[collect[i].path] = true;
  }

  var stillCharging = [];
  var newlyReady = [];
  for (var j = 0; j < charging.length; j++) {
    var c = charging[j];
    if (now >= c.charge_end) {
      newlyReady.push(c);
    } else {
      stillCharging.push(c);
    }
  }

  // Emit events in temporal order (earliest charge_end first) so Game.js
  // handlers light up the UI as if the player had been watching live.
  newlyReady.sort(function(a, b) { return a.charge_end - b.charge_end; });

  for (var k = 0; k < newlyReady.length; k++) {
    var entry = newlyReady[k];
    // Guard against a path being present in both arrays simultaneously.
    if (!inCollect[entry.path]) {
      collect.push({ path: entry.path, result: entry.result });
      inCollect[entry.path] = true;
    }
    events.push({
      ev: 'node_ready',
      pl: {
        id:     entry.game_id,
        type:   entry.game_type,
        path:   entry.path,
        result: entry.result
      }
    });
  }

  // ── Rule 2: AP regeneration (docs/async-map.md §cross-cutting) ──────────
  // Advance the ap_snapshot to `now` so that every downstream read gets the
  // current AP without re-running the calculation.
  // Mirrors dd_app/helpers.py::calculateAP.
  var gv = state.game_values || {};
  var newGv = Object.assign({}, gv);
  if (
    typeof gv.ap_snapshot    === 'number' &&
    typeof gv.ap_inc_value   === 'number' &&
    gv.ap_inc_interval > 0                &&
    typeof gv.ap_max         === 'number'
  ) {
    // Lazy-init: when ap_update is null/undefined (e.g. fresh game), start
    // the regen clock at `now` so the next materialize-after-elapsed-time
    // can tick. Without this, ap_update stays null forever and regen never
    // runs, so APs added in-memory by Game.js APTicker reset to ap_snapshot
    // on every reload.
    var apUpdate = (typeof gv.ap_update === 'number') ? gv.ap_update : now;
    var elapsed  = Math.max(0, now - apUpdate);
    var ticks    = Math.floor(elapsed / gv.ap_inc_interval);
    newGv = Object.assign({}, gv, {
      ap_snapshot: Math.min(gv.ap_max, gv.ap_snapshot + ticks * gv.ap_inc_value),
      // Advance ap_update only to the last full-tick boundary so the
      // fractional remainder is preserved across stepwise materializations.
      ap_update: apUpdate + ticks * gv.ap_inc_interval,
    });
  }

  // ── notifyLevelupItems / notifyBuyperpItems (docs/async-map.md §2–3) ────
  // Both tasks are purely cosmetic (2 s delay so animation completes) with no
  // DB write and no persistent duration.  In the port they run synchronously
  // inside the RPC handler at the moment the level-up or buyPerp is
  // processed.  No materialization rule is needed here.

  // ── logAction (docs/async-map.md §4) ────────────────────────────────────
  // Analytics-only sink; no gameplay state; drop on port (v1).

  return {
    state: Object.assign({}, state, {
      nodes_charging: stillCharging,
      nodes_collect:  collect,
      game_values:    newGv
    }),
    events: events
  };
}

export { materialize };
