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
  'setLocale',
  'dismissMissionBriefing',
  'markTokenSeen',
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
 *   node_counter    — monotonic node id counter for buyPerp
 *   integrated_ids  — set of collect_ids already processed by integrateCollected
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

  // Seed starting equipment + active missions inline so the baseline state
  // produced by freshState (and therefore by every cold-start replay)
  // already contains the trunk-mission state.
  // This MUST happen at the freshState level: lazy seeding inside loadGame
  // doesn't survive replay, so a buyPerp delta committed after a reset
  // would re-add itself on cold start *without* its seeded parent and
  // crash GameRoot.loadGame's parent lookup.
  var seededNodes = _seedNodesFromTree(src);

  return {
    schema_version: SCHEMA_VERSION,
    addr: selfAddr || '',
    display_name: '',
    game_version: null,
    version: null,
    nodes: seededNodes,
    nodes_charging: [],
    nodes_collect: [],
    db_queue: [],
    game_values: gv,
    mission_goals: [],
    active_missions: (src.active_missions || []).slice(),
    last_seen_ts: 0,
    node_counter: 0,
    integrated_ids: {},
    mission_briefings_seen: {},
    tokens_seen: {},
  };
}

/**
 * @deprecated Seed is now applied directly in freshState; this is kept as a
 * no-op shim so callers (e.g. LocalEngine.loadGame) compile during the
 * transition.  Remove once all call sites are gone.
 */
export function seedNewGame(state) {
  return state;
}


function _seedNodesFromTree(src) {
  var out = [];

  function splitFullType(ft) {
    var s = String(ft || '');
    var i = s.indexOf(':');
    return i >= 0 ? [s.slice(0, i), s.slice(i + 1)] : ['', ''];
  }

  function walk(parentPath, child) {
    if (!child || !child.full_type) return;
    var parts = splitFullType(child.full_type);
    var gameType = parts[0];
    var gestalt = parts[1];
    if (!gestalt) return;
    var fullPath = parentPath + '.' + gestalt;
    out.push({
      // game_id MUST equal the path's last segment — Game.js:getByLastId looks
      // nodes up that way (e.g. Database.cue → ps.origin = getByLastId(path)).
      game_id: gestalt,
      game_type: gameType,
      full_type: child.full_type,
      gestalt: gestalt,
      full_path: fullPath,
      instance_data: Object.assign({}, child.instance_data || {}),
    });
    var grandkids = child.children || [];
    for (var i = 0; i < grandkids.length; i++) walk(fullPath, grandkids[i]);
  }

  ['Imperium', 'Database'].forEach(function (root) {
    var node = src[root];
    if (!node || !Array.isArray(node.children)) return;
    for (var i = 0; i < node.children.length; i++) walk(root, node.children[i]);
  });

  return out;
}

// ---------------------------------------------------------------------------
// Reducers
// ---------------------------------------------------------------------------
// Each reducer is a pure function (state, delta) → newState.

var reducers = {};

reducers.setDisplayName = function setDisplayNameReducer(state, delta) {
  var args = delta.args || [];
  var dname = args[0];
  if (typeof dname !== 'string' || dname.length === 0) return state;
  return Object.assign({}, state, { display_name: dname });
};

// 'setLocale' stores the player's preferred locale shorthand ('de' or 'en').
// Preserved across resets so the language choice survives a game wipe.
reducers.setLocale = function setLocaleReducer(state, delta) {
  var locale = delta.locale;
  if (locale !== 'de' && locale !== 'en') return state;
  return Object.assign({}, state, { locale: locale });
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

  // Each buyPerp creates exactly one node, so the counter advances by 1 on
  // every replayed delta.  (The handler in LocalEngine does the same; we
  // can't read the value off newNode.game_id any more since it now equals
  // the gestalt instead of an encoded counter.)
  var counter = (state.node_counter || 0) + 1;

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

reducers.collectPerp = function collectPerpReducer(state, delta) {
  if (!delta || !delta.result) return state;
  var r = delta.result;
  var path = delta.args && delta.args[0];

  var newCollect = (state.nodes_collect || []).filter(function (e) {
    return e.path !== path;
  });

  var newGv = r.game_values
    ? Object.assign({}, state.game_values, r.game_values)
    : state.game_values;

  var newQueue = state.db_queue || [];
  if (r.db_entry) {
    var inQueue = newQueue.some(function (q) { return q.collect_id === r.db_entry.collect_id; });
    if (!inQueue) newQueue = newQueue.concat([r.db_entry]);
  }

  var newNodes = state.nodes;
  if (r.token_update) {
    newNodes = state.nodes.map(function (n) {
      if (n.full_path !== r.token_update.path) return n;
      return Object.assign({}, n, {
        instance_data: Object.assign({}, n.instance_data, { amount: r.token_update.amount })
      });
    });
  }

  return Object.assign({}, state, {
    nodes_collect: newCollect,
    game_values:   newGv,
    db_queue:      newQueue,
    nodes:         newNodes
  });
};

reducers.integrateCollected = function integrateCollectedReducer(state, delta) {
  if (!delta || !delta.result) return state;
  var r = delta.result;
  var collectId = delta.args && delta.args[0];

  var newQueue = (state.db_queue || []).filter(function (q) {
    return q.collect_id !== collectId;
  });

  var newIntegratedIds = Object.assign({}, state.integrated_ids || {});
  if (collectId) newIntegratedIds[collectId] = true;

  var newGv = r.game_values
    ? Object.assign({}, state.game_values, r.game_values)
    : state.game_values;

  var newNodes = state.nodes;
  if (r.nodes && r.nodes.length) {
    var updMap = {};
    r.nodes.forEach(function (u) { updMap[u.full_path] = u; });
    newNodes = state.nodes.map(function (n) {
      var u = updMap[n.full_path];
      return u ? Object.assign({}, n, { instance_data: u.instance_data }) : n;
    });
  }

  return Object.assign({}, state, {
    db_queue:       newQueue,
    integrated_ids: newIntegratedIds,
    game_values:    newGv,
    nodes:          newNodes
  });
};

reducers.markTokenSeen = function markTokenSeenReducer(state, delta) {
  var args = delta.args || [];
  var gestalt = args[0];
  if (typeof gestalt !== 'string' || !gestalt) return state;
  var seen = Object.assign({}, state.tokens_seen || {});
  if (seen[gestalt]) return state;
  seen[gestalt] = true;
  return Object.assign({}, state, { tokens_seen: seen });
};

reducers.dismissMissionBriefing = function dismissMissionBriefingReducer(state, delta) {
  var args = delta.args || [];
  var gestalt = args[0];
  if (typeof gestalt !== 'string' || !gestalt) return state;
  var seen = Object.assign({}, state.mission_briefings_seen || {});
  if (seen[gestalt]) return state;
  seen[gestalt] = true;
  return Object.assign({}, state, { mission_briefings_seen: seen });
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
