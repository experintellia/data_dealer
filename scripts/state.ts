// State model for the webxdc port of Data Dealer.
// Source of truth is webxdc.sendUpdate history; this module builds in-memory
// state by replaying deltas from serial 0 on every cold start.
//
// LocalState mirrors the MongoDB `games` + `users` doc structure from
// docs/handler-map.md. Wave 3 issues (#12–#21) fill in the reducer stubs.

import defaultGameData from '../data/default_game.json';
import { now as clockNow } from './clock.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Economy counters kept in state.game_values. */
export interface GameValues {
  xp_value?: number;
  xp_level?: number;
  cash_value?: number;
  cash_spent?: number;
  karma_value?: number;
  profiles_value?: number;
  profiles_max?: number;
  ap_snapshot?: number;
  /** Epoch-ms of the last AP snapshot; null on a fresh game. */
  ap_update?: number | null;
  /** AP gained per regen tick. */
  ap_inc_value?: number;
  /** Milliseconds between regen ticks. */
  ap_inc_interval?: number;
  /** AP ceiling. */
  ap_max?: number;
  [key: string]: unknown;
}

/** A single perp/token/contact/project node in state.nodes. */
export interface GameNode {
  game_id: string;
  game_type: string;
  full_type?: string;
  gestalt?: string;
  full_path: string;
  instance_data: Record<string, any>;
}

/** An in-flight charge entry in state.nodes_charging. */
export interface ChargingEntry {
  path: string;
  result: any;
  charge_start: number;
  charge_end: number;
  game_id: string;
  game_type: string;
}

/** A ready-to-collect entry in state.nodes_collect. */
export interface CollectEntry {
  path: string;
  result: any;
}

/** A pending profile-set integration in state.db_queue. */
export interface DbQueueEntry {
  origin: string;
  collect_id: string;
  profile_set: any;
  /** Epoch-ms timestamp of collection (added by collectPerp in LocalEngine). */
  collect_dt?: number;
}

/** A single mission-progress row in state.mission_goals. */
export interface MissionGoal {
  amount: number;
  current_amount: number;
  goal_id: string;
  mission: string;
  position: number;
  project: string | null;
  target: string;
  workflow: string;
  complete?: boolean;
}

/** Aggregated peer stats tracked in state.peers[addr]. */
export interface PeerEntry {
  cash?: number;
  profiles?: number;
  xp?: number;
  level?: number;
  spent?: number;
  display_name?: string;
  last_seen_ts?: number;
  last_seen_serial?: number | null;
}

/**
 * LocalState — the single in-memory game state document.
 *
 * Mirrors the MongoDB `games` collection doc (docs/handler-map.md §"games
 * collection"). Every field that can be absent on a freshly-seeded state is
 * marked optional; all fields present in freshState() are required.
 */
export interface LocalState {
  schema_version: number;
  /** webxdc.selfAddr; the stable identity for this player. */
  addr: string;
  display_name: string;
  game_version: string | null;
  version: string | null;
  nodes: GameNode[];
  nodes_charging: ChargingEntry[];
  nodes_collect: CollectEntry[];
  db_queue: DbQueueEntry[];
  game_values: GameValues;
  mission_goals: MissionGoal[];
  active_missions: string[];
  /** Monotonic epoch-ms timestamp; guards against clock-skew rewinding progress. */
  last_seen_ts: number;
  /** Monotonic node-id counter; incremented by buyPerp. */
  node_counter: number;
  integrated_ids: Record<string, boolean>;
  mission_briefings_seen: Record<string, boolean>;
  tokens_seen: Record<string, boolean>;
  peers: Record<string, PeerEntry>;
  /** Player's preferred locale ('de' | 'en'); persisted by setLocale. */
  locale?: string;
}

/**
 * Delta — the persisted unit of state mutation.
 *
 * Shape from issue #10:
 *   { kind: 'delta', addr, op, args, result, ts }
 *
 * `args` and `result` are typed as `any` rather than `unknown` because the
 * reducers destructure them freely; strict-mode narrowing is #147's job.
 */
export interface Delta {
  kind: 'delta';
  addr: string;
  op: string;
  args?: any[];
  result?: any;
  ts?: number;
  /** Carried by setLocale deltas. */
  locale?: string;
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

type Reducer = (state: LocalState, delta: Delta) => LocalState;

interface GameNodeDef {
  full_type?: string;
  instance_data?: Record<string, any>;
  children?: GameNodeDef[];
}

interface GameSeed {
  game_values?: Partial<GameValues>;
  active_missions?: string[];
  Imperium?: { children?: GameNodeDef[] };
  Database?: { children?: GameNodeDef[] };
  [key: string]: any;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export var SCHEMA_VERSION = 1;

var _defaultSeed: GameSeed = (defaultGameData as GameSeed) || { game_values: {} };

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

// ---------------------------------------------------------------------------
// freshState
// ---------------------------------------------------------------------------

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
export function freshState(selfAddr?: string, seed?: GameSeed): LocalState {
  var src: GameSeed = (seed || _defaultSeed) || {};
  var gv: GameValues = Object.assign(
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
    peers: {},
  };
}

/**
 * @deprecated Seed is now applied directly in freshState; this is kept as a
 * no-op shim so callers (e.g. LocalEngine.loadGame) compile during the
 * transition.  Remove once all call sites are gone.
 */
export function seedNewGame(state: LocalState): LocalState {
  return state;
}


function _seedNodesFromTree(src: GameSeed): GameNode[] {
  var out: GameNode[] = [];

  function splitFullType(ft: any): [string, string] {
    var s = String(ft || '');
    var i = s.indexOf(':');
    return i >= 0 ? [s.slice(0, i), s.slice(i + 1)] : ['', ''];
  }

  function walk(parentPath: string, child: GameNodeDef): void {
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
    for (var i = 0; i < grandkids.length; i++) {
      var gk = grandkids[i];
      if (gk) walk(fullPath, gk);
    }
  }

  ['Imperium', 'Database'].forEach(function (root) {
    var node = src[root];
    if (!node || !Array.isArray(node.children)) return;
    for (var i = 0; i < node.children.length; i++) {
      var ch = node.children[i];
      if (ch) walk(root, ch);
    }
  });

  return out;
}

// ---------------------------------------------------------------------------
// Reducers
// ---------------------------------------------------------------------------
// Each reducer is a pure function (state, delta) → newState.

var reducers: Record<string, Reducer> = {};

// Pulls mission_goals + active_missions out of a delta result whose
// progression handler shipped them under .missions.mission_data. Returns
// pass-through values when the delta has no mission update so reducers can
// always spread the result without a conditional.
function _missionDataFromResult(state: LocalState, r: any): { mission_goals: MissionGoal[]; active_missions: string[] } {
  var md = r && r.missions && r.missions.mission_data;
  return {
    mission_goals: (md && md.mission_goals) || state.mission_goals,
    active_missions: (md && md.active_missions) || state.active_missions
  };
}

function _filterByPath(arr: Array<{ path: string }> | undefined, path: string): Array<{ path: string }> {
  return (arr || []).filter(function (e) { return e.path !== path; });
}

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

  var coordMap: Record<string, { x: number; y: number }> = {};
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
function _nodeGvReducer(state: LocalState, delta: Delta): LocalState {
  var res = (delta && delta.result) || {};
  if (!res.node || !res.node.full_path) return state;

  var fullPath = res.node.full_path;
  var newNodes = state.nodes.map(function (n) {
    if (n.full_path !== fullPath) return n;
    return Object.assign({}, n, { instance_data: res.node.instance_data });
  });

  var mp = _missionDataFromResult(state, res);
  return Object.assign({}, state, {
    nodes:           newNodes,
    game_values:     Object.assign({}, state.game_values, res.game_values || {}),
    mission_goals:   mp.mission_goals,
    active_missions: mp.active_missions,
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
  var alreadyPresent = nodes.some(function (n) { return n.full_path === newNode.full_path; });
  if (!alreadyPresent) {
    nodes = nodes.concat([newNode]);
  }

  var dbQueue = (state.db_queue || []).slice();
  if (r.profile_set) {
    var ps = r.profile_set;
    var inQueue = dbQueue.some(function (q) { return q.collect_id === ps.collect_id; });
    if (!inQueue) {
      dbQueue = dbQueue.concat([{
        origin: ps.origin,
        collect_id: ps.collect_id,
        profile_set: ps.profile_set
      }]);
    }
  }

  var mp = _missionDataFromResult(state, r);

  // Snapshot pattern: the handler emits the post-mutation node_counter in
  // r.node_counter so listener echo is idempotent. Fallback to incremental
  // for legacy pre-fix deltas (one buyPerp creates exactly one node).
  var counter = (typeof r.node_counter === 'number')
    ? r.node_counter
    : (state.node_counter || 0) + 1;

  return Object.assign({}, state, {
    nodes: nodes,
    db_queue: dbQueue,
    game_values: r.game_values || state.game_values,
    mission_goals: mp.mission_goals,
    active_missions: mp.active_missions,
    node_counter: counter
  });
};

reducers.chargePerp = function chargePerpReducer(state, delta) {
  var r           = delta.result || {};
  var chargeEntry = r.chargeEntry;
  if (!chargeEntry || !chargeEntry.path) return state;

  // Key by path, not positional index: cold-start replay can reorder
  // state.nodes between the handler and the reducer, so a stale index
  // would charge the wrong perp.
  var path     = chargeEntry.path;
  var nodes    = state.nodes || [];
  var newNodes = nodes.map(function(n) {
    if (n.full_path !== path) return n;
    return Object.assign({}, n, {
      instance_data: Object.assign({}, n.instance_data, {
        charge_start: chargeEntry.charge_start
      })
    });
  });

  var stillCharging = _filterByPath(state.nodes_charging, chargeEntry.path) as ChargingEntry[];

  // Snapshot pattern (#119/#120): the handler emits the post-mutation
  // game_values in r.game_values; applying it via Object.assign is idempotent
  // under self-echo. The incremental form below remains as a fallback for
  // already-persisted pre-fix deltas so they still replay correctly.
  var gv    = state.game_values || {};
  var newGv: GameValues;
  if (r.game_values) {
    newGv = Object.assign({}, gv, r.game_values);
  } else {
    var cashDelta = typeof r.cashDelta === 'number' ? r.cashDelta : 0;
    var xpInc     = typeof r.xpInc    === 'number' ? r.xpInc    : 0;
    newGv = Object.assign({}, gv, {
      cash_value:  (gv.cash_value  || 0) - cashDelta,
      cash_spent:  (gv.cash_spent  || 0) + cashDelta,
      xp_value:    (gv.xp_value   || 0) + xpInc,
      ap_snapshot: Math.max(0, (gv.ap_snapshot || 0) - 1),
    });
  }

  var mp = _missionDataFromResult(state, r);
  return Object.assign({}, state, {
    nodes:           newNodes,
    nodes_charging:  stillCharging.concat([chargeEntry]),
    game_values:     newGv,
    mission_goals:   mp.mission_goals,
    active_missions: mp.active_missions,
  });
};

reducers.collectPerp = function collectPerpReducer(state, delta) {
  if (!delta || !delta.result) return state;
  var r = delta.result;
  var path = delta.args && delta.args[0];

  var newCollect = _filterByPath(state.nodes_collect, path) as CollectEntry[];
  // Closes #114: also strip the nodes_charging entry by path so replay
  // produces the same shape as the live materializer-then-collect flow.
  // Without this, replay-from-zero leaves the stale charging entry, then
  // materialize() re-promotes the path back to nodes_collect — perp
  // appears collectable again after reload.
  var newCharging = _filterByPath(state.nodes_charging, path) as ChargingEntry[];

  var newGv: GameValues = r.game_values
    ? Object.assign({}, state.game_values, r.game_values)
    : state.game_values;

  var newQueue: DbQueueEntry[] = state.db_queue || [];
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

  var mp = _missionDataFromResult(state, r);
  return Object.assign({}, state, {
    nodes_collect:  newCollect,
    nodes_charging: newCharging,
    game_values:    newGv,
    db_queue:       newQueue,
    nodes:          newNodes,
    mission_goals:  mp.mission_goals,
    active_missions: mp.active_missions
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

  var newGv: GameValues = r.game_values
    ? Object.assign({}, state.game_values, r.game_values)
    : state.game_values;

  var newNodes = state.nodes;
  if (r.nodes && r.nodes.length) {
    var existingPaths: Record<string, boolean> = {};
    var updMap: Record<string, any> = {};
    r.nodes.forEach(function (u: any) { updMap[u.full_path] = u; });
    newNodes = state.nodes.map(function (n) {
      existingPaths[n.full_path] = true;
      var u = updMap[n.full_path];
      return u ? Object.assign({}, n, { instance_data: u.instance_data }) : n;
    });
    // Append fresh TokenPerp nodes (first-time integration of a token type).
    r.nodes.forEach(function (u: any) {
      if (existingPaths[u.full_path]) return;
      newNodes = newNodes.concat([{
        game_id:       u.game_id,
        gestalt:       u.gestalt,
        game_type:     u.game_type,
        full_type:     u.full_type,
        full_path:     u.full_path,
        instance_data: u.instance_data || {}
      }]);
    });
  }

  var mp = _missionDataFromResult(state, r);
  return Object.assign({}, state, {
    db_queue:       newQueue,
    integrated_ids: newIntegratedIds,
    game_values:    newGv,
    nodes:          newNodes,
    mission_goals: mp.mission_goals,
    active_missions: mp.active_missions
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
// Peer aggregator
// ---------------------------------------------------------------------------

// Updates state.peers[delta.addr] from every inbound delta (own or foreign).
// Only reads delta.result.game_values and delta.op/args/ts — never touches the
// per-self reducer targets (display_name on state, tokens_seen, etc.).
//
// LWW policy: a delta whose ts is strictly less than the peer's last_seen_ts
// is silently skipped.  webxdc delivers per-sender messages in order, so this
// only fires when a stale delta arrives out-of-band (e.g. a re-delivered echo
// with an old timestamp, or a hypothetical multi-device race).  It makes the
// aggregator timestamp-LWW rather than insertion-order-LWW.
function _applyPeerDelta(state: LocalState, delta: Delta): LocalState {
  var addr = delta.addr;
  if (!addr) return state;

  var peers = state.peers || {};
  var existing: PeerEntry = peers[addr] || {};

  // Stale-delta guard: skip if this delta is older than the last we recorded.
  var prevTs = typeof existing.last_seen_ts === 'number' ? existing.last_seen_ts : -Infinity;
  if (typeof delta.ts === 'number' && delta.ts < prevTs) return state;

  var peer: PeerEntry = Object.assign({}, existing);

  var gv = delta.result && delta.result.game_values;
  if (gv) {
    if (typeof gv.cash_value     === 'number') peer.cash     = gv.cash_value;
    if (typeof gv.profiles_value === 'number') peer.profiles = gv.profiles_value;
    if (typeof gv.xp_value       === 'number') peer.xp       = gv.xp_value;
    if (typeof gv.xp_level       === 'number') peer.level    = gv.xp_level;
    if (typeof gv.cash_spent     === 'number') peer.spent    = gv.cash_spent;
  }

  if (delta.op === 'setDisplayName') {
    var args = delta.args || [];
    var dname = args[0];
    if (typeof dname === 'string' && dname.length > 0) {
      peer.display_name = dname;
    }
  }

  if (typeof delta.ts === 'number') peer.last_seen_ts = delta.ts;
  if (!('last_seen_serial' in peer)) peer.last_seen_serial = null;

  var newPeers = Object.assign({}, peers);
  newPeers[addr] = peer;
  return Object.assign({}, state, { peers: newPeers });
}

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
export function applyDelta(state: LocalState, delta: any): LocalState {
  if (!delta || typeof delta !== 'object' || delta.kind !== 'delta') {
    return state;
  }

  // Guard 2: schema version mismatch — reset rather than crash.
  // Deferred when state.addr is empty: addr has not been seeded yet, so
  // resetting now would produce a fresh state that also has addr='' which
  // Guard 3 then uses to block all subsequent own-addr deltas.  The reset
  // fires on the first delta after boot() seeds the real addr.
  if (state.addr && state.schema_version !== SCHEMA_VERSION) {
    return freshState(state.addr);
  }

  // Peer aggregator: runs for every delta regardless of addr.  Updates
  // state.peers[delta.addr] from game_values snapshot + display_name.
  // Separated from the per-self reducer path so the addr guard below
  // can still block other-peer deltas from mutating own state (e.g.
  // mission_briefings_seen, tokens_seen per #105).
  state = _applyPeerDelta(state, delta as Delta);

  // Guard 3: ignore other peers' deltas (multi-device: only own addr mutates).
  // Runs before any state.addr mutation; also fires when state.addr is empty
  // so a foreign delta can never seed our identity (closes #130).
  if (delta.addr && delta.addr !== state.addr) {
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
  return reducer(next, delta as Delta);
}
