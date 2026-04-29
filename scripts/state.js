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
    node_counter: 0,
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

// 'buyPerp' replays the state mutations committed by the LocalEngine handler.
// The delta result carries the full post-mutation values so replay is exact.
reducers.buyPerp = function buyPerpReducer(state, delta) {
  if (!delta || !delta.result || !delta.result.node) {
    return state;
  }

  var r = delta.result;
  var newNode = r.node;

  // Guard against double-apply on replay.
  var nodes = (state.nodes || []).slice();
  var alreadyPresent = false;
  for (var i = 0; i < nodes.length; i++) {
    if (nodes[i].full_path === newNode.full_path) { alreadyPresent = true; break; }
  }
  if (!alreadyPresent) {
    nodes = nodes.concat([newNode]);
  }

  var dbQueue = (state.db_queue || []).slice();
  if (r.profile_set) {
    var ps = r.profile_set;
    var inQueue = false;
    for (var j = 0; j < dbQueue.length; j++) {
      if (dbQueue[j].collect_id === ps.collect_id) { inQueue = true; break; }
    }
    if (!inQueue) {
      dbQueue = dbQueue.concat([{
        origin: ps.origin,
        collect_id: ps.collect_id,
        profile_set: ps.profile_set
      }]);
    }
  }

  var missionGoals = state.mission_goals;
  var activeMissions = state.active_missions;
  if (r.missions && r.missions.mission_data) {
    if (r.missions.mission_data.mission_goals) {
      missionGoals = r.missions.mission_data.mission_goals;
    }
    if (r.missions.mission_data.active_missions) {
      activeMissions = r.missions.mission_data.active_missions;
    }
  }

  // Keep node_counter monotonic.
  var counter = state.node_counter || 0;
  var idNum = parseInt(String(newNode.game_id).replace('node_', ''), 10);
  if (!isNaN(idNum) && idNum > counter) { counter = idNum; }

  return Object.assign({}, state, {
    nodes: nodes,
    db_queue: dbQueue,
    game_values: r.game_values || state.game_values,
    mission_goals: missionGoals,
    active_missions: activeMissions,
    node_counter: counter
  });
};

reducers.chargePerp = function chargePerpReducer(state, delta) {
  var r           = delta.result || {};
  var chargeEntry = r.chargeEntry;
  if (!chargeEntry || typeof r.nodeIdx !== 'number') return state;

  var nodeIdx   = r.nodeIdx;
  var cashDelta = typeof r.cashDelta === 'number' ? r.cashDelta : 0;
  var xpInc     = typeof r.xpInc    === 'number' ? r.xpInc    : 0;

  var nodes    = state.nodes || [];
  var newNodes = nodes.map(function(n, i) {
    if (i !== nodeIdx) return n;
    return Object.assign({}, n, {
      instance_data: Object.assign({}, n.instance_data, {
        charge_start: chargeEntry.charge_start
      })
    });
  });

  var stillCharging = (state.nodes_charging || []).filter(function(c) {
    return c.path !== chargeEntry.path;
  });

  var gv    = state.game_values || {};
  var newGv = Object.assign({}, gv, {
    cash_value:  (gv.cash_value  || 0) - cashDelta,
    cash_spent:  (gv.cash_spent  || 0) + cashDelta,
    xp_value:    (gv.xp_value   || 0) + xpInc,
    ap_snapshot: Math.max(0, (gv.ap_snapshot || 0) - 1),
  });

  return Object.assign({}, state, {
    nodes:          newNodes,
    nodes_charging: stillCharging.concat([chargeEntry]),
    game_values:    newGv,
  });
};

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
