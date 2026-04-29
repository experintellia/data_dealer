// State model for the webxdc port of Data Dealer.
// Source of truth is webxdc.sendUpdate history; this module builds in-memory
// state by replaying deltas from serial 0 on every cold start.
//
// LocalState mirrors the MongoDB `games` + `users` doc structure from
// docs/handler-map.md. Wave 3 issues (#12–#21) fill in the reducer stubs.

import defaultGameData from '../data/default_game.json';
import { now as clockNow } from './clock.js';

export var SCHEMA_VERSION = 1;

var _defaultSeed = defaultGameData || { game_values: {} };

// Every handler op that can appear as delta.op.  Read-only handlers
// (getToken, ping, etc.) never produce deltas but get stubs for completeness.
var OP_NAMES = [
  'reset',
  'loadGame',
  'setPerpCoordinates',
  'integrateCollected',
  'collectPerp',
  'chargePerp',
  'buySlots',
  'buyKarma',
  'buyPerp',
  'getProvidedPerps',
  'sellPowerup',
  'buyPowerup',
  'getPowerups',
  'setDisplayName',
  'getRanking',
  'getToken',
  'getSessionLocale',
  'ping',
  'checkUsername',
];

/**
 * freshState(selfAddr?, seed?) → LocalState
 *
 * Returns a zeroed-out state seeded from data/default_game.json (or the
 * optional `seed` argument).  `selfAddr` becomes state.addr — matches
 * webxdc.selfAddr in production and an arbitrary string in tests.
 *
 * LocalState shape mirrors the MongoDB `games` collection doc
 * (docs/handler-map.md §"games collection"):
 *
 *   schema_version  — migration guard
 *   addr            — auth_uid equivalent; webxdc.selfAddr in production
 *   display_name    — from setDisplayName
 *   game_version    — rules version pin (null = latest)
 *   version         — rules version string returned by loadGame
 *   nodes           — perp/token/contact/project tree
 *   nodes_charging  — {path, result, charge_start, charge_end}[]
 *   nodes_collect   — {path, result}[] ready to collectPerp
 *   db_queue        — profile-set queue {origin, collect_id, profile_set}[]
 *   game_values     — economy counters (xp, cash, karma, profiles, ap …)
 *   mission_goals   — mission progress rows
 *   active_missions — currently-active mission gestalt IDs
 *   last_seen_ts    — monotonic clock (clock-skew guard)
 */
export function freshState(selfAddr, seed) {
  var src = (seed || _defaultSeed) || {};
  var gv = Object.assign(
    {
      xp_value: 0,
      xp_level: 1,
      cash_value: 0,
      cash_spent: 0,
      karma_value: 0,
      profiles_value: 0,
      profiles_max: 1,
      ap_snapshot: 0,
      ap_update: null,
    },
    src.game_values || {}
  );

  return {
    schema_version: SCHEMA_VERSION,
    addr: selfAddr || '',
    display_name: '',
    game_version: null,
    version: null,
    nodes: [],
    nodes_charging: [],
    nodes_collect: [],
    db_queue: [],
    game_values: gv,
    mission_goals: [],
    active_missions: [],
    last_seen_ts: 0,
  };
}

// ---------------------------------------------------------------------------
// Reducers
// ---------------------------------------------------------------------------
// Each reducer is a pure function (state, delta) → newState.
// Only 'reset' is fully implemented here; Wave 3 issues (#12–#21) replace
// the stubs with real logic.

var reducers = {};

// 'reset' discards all prior state and reseeds from the default game.
// Addr is preserved so replay identity is not lost.
reducers.reset = function resetReducer(state) {
  return freshState(state.addr);
};

reducers.setDisplayName = function setDisplayNameReducer(state, delta) {
  var args = delta.args || [];
  var dname = args[0];
  if (typeof dname !== 'string' || dname.length === 0) return state;
  return Object.assign({}, state, { display_name: dname });
};

reducers.setPerpCoordinates = function setPerpCoordinatesReducer(state, delta) {
  var args = delta.args || [];
  var updates = args[0];
  if (!Array.isArray(updates) || !Array.isArray(state.nodes)) return state;

  var coordMap = {};
  for (var i = 0; i < updates.length; i++) {
    var entry = updates[i];
    if (!Array.isArray(entry) || entry.length < 2) continue;
    var path = entry[0];
    var pos  = entry[1];
    if (typeof path !== 'string' || !pos || typeof pos !== 'object') continue;
    coordMap[path] = pos;
  }

  var nodes = state.nodes.map(function (node) {
    var pos = coordMap[node.full_path];
    if (!pos) return node;
    return Object.assign({}, node, {
      instance_data: Object.assign({}, node.instance_data, { x: pos.x, y: pos.y })
    });
  });

  return Object.assign({}, state, { nodes: nodes });
};

reducers.buyKarma = function buyKarmaReducer(state, delta) {
  var gv = delta.result && delta.result.game_values;
  if (!gv) return state;
  return Object.assign({}, state, {
    game_values: Object.assign({}, state.game_values, gv)
  });
};

// Shared reducer for buyPowerup / sellPowerup / buySlots.
// The delta result carries {node: {full_path, instance_data}, game_values}.
// The reducer patches the matching node's instance_data and merges game_values.
function _nodeGvReducer(state, delta) {
  var res = (delta && delta.result) || {};
  if (!res.node || !res.node.full_path) return state;

  var fullPath = res.node.full_path;
  var newNodes = state.nodes.map(function (n) {
    if (n.full_path !== fullPath) return n;
    return Object.assign({}, n, { instance_data: res.node.instance_data });
  });

  return Object.assign({}, state, {
    nodes:       newNodes,
    game_values: Object.assign({}, state.game_values, res.game_values || {})
  });
}

reducers.buyPowerup  = _nodeGvReducer;
reducers.sellPowerup = _nodeGvReducer;
reducers.buySlots    = _nodeGvReducer;

// Stubs — return state unchanged until Wave 4+ fills them in.
OP_NAMES.forEach(function (op) {
  if (!reducers[op]) {
    reducers[op] = function stubReducer(state) {
      return state;
    };
  }
});

// ---------------------------------------------------------------------------
// applyDelta
// ---------------------------------------------------------------------------

/**
 * applyDelta(state, delta) → newState  (pure)
 *
 * Delta payload shape (issue #10):
 *   { kind: 'delta', addr: string, op: string, args: any[], result: object, ts: number }
 *
 * Guards applied (in order):
 *   1. Malformed delta  → return state unchanged
 *   2. Schema-version mismatch → reset to freshState (graceful forward-compat)
 *   3. Other-peer addr  → skip (Phase 6 leaderboard handles cross-user deltas)
 *   4. Clock-skew guard → last_seen_ts = max(Date.now(), last_seen_ts)
 *   5. Dispatch to reducer[delta.op]; unknown op → return guarded state as-is
 */
export function applyDelta(state, delta) {
  if (!delta || typeof delta !== 'object' || delta.kind !== 'delta') {
    return state;
  }

  // Guard 2: schema version mismatch — reset rather than crash
  if (state.schema_version !== SCHEMA_VERSION) {
    return freshState(state.addr);
  }

  // Guard 3: ignore other peers' deltas (multi-device: only own addr mutates)
  if (state.addr && delta.addr && delta.addr !== state.addr) {
    return state;
  }

  // Guard 4: monotonic clock — wrong system clock (or stale test override)
  // never rewinds stored progress; clockNow() is injectable from clock.js.
  var now = Math.max(clockNow(), state.last_seen_ts);
  var next = Object.assign({}, state, { last_seen_ts: now });

  // Guard 5: dispatch
  var reducer = reducers[delta.op];
  if (!reducer) {
    return next;
  }
  return reducer(next, delta);
}
