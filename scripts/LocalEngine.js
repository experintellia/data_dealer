// Local replacement for the back-end JSON-RPC service.
// ESM exports — consumed by Remote.js via the AMD bridge in esm-bundle.js.
// No DOM globals in handler bodies; safe to import from Node for tests.
//
// Handlers implemented here: getToken, ping, getSessionLocale, loadGame (#12),
// resetGame (#20), getRanking, setDisplayName, setPerpCoordinates (#13),
//   getProvidedPerps, getPowerups (#14), buyKarma (#19).
// Remaining handlers are stubs that return a rejected Promise.

import { getState, setState } from './boot.js';
import { applyDelta } from './state.js';
import { materialize } from './materializer.js';
import { now as clockNow } from './clock.js';
import rulesetDe from '../data/ruleset_3.de.json' with { type: 'json' };
import rulesetEn from '../data/ruleset_3.en.json' with { type: 'json' };

// ---------------------------------------------------------------------------
// Event emitter — injected by production boot (app.js); no-op in tests.
// Call setEmitter(fn) with fn(ev, pl) before any gameplay begins.
// ---------------------------------------------------------------------------
var _emitter = null;

export function setEmitter(fn) {
  _emitter = fn;
}

function _emit(ev, pl) {
  if (_emitter) _emitter(ev, pl);
}

// ---------------------------------------------------------------------------
// Ruleset selection — locale-memoised, node-index helpers
// ---------------------------------------------------------------------------

function _getRuleset() {
  var state = getState();
  var locale = (state && state.locale) || 'de';
  return (locale === 'en') ? rulesetEn : rulesetDe;
}

var _nodeMapRef = null;
var _nodeMapCache = null;

function _getNodeMaps(nodes) {
  if (nodes === _nodeMapRef) return _nodeMapCache;
  _nodeMapRef = nodes;
  var paths = {};
  var gestalts = {};
  for (var i = 0; i < nodes.length; i++) {
    paths[nodes[i].full_path] = nodes[i];
    var g = nodes[i].gestalt || _gestaltFrom(nodes[i].full_type);
    if (g) gestalts[g] = true;
  }
  _nodeMapCache = { paths: paths, gestalts: gestalts };
  return _nodeMapCache;
}

function _gestaltFrom(fullType) {
  if (!fullType) return null;
  var idx = fullType.indexOf(':');
  return idx >= 0 ? fullType.slice(idx + 1) : null;
}

function _isProvidable(gestalt, ruleset, playerLevel, ownedGestalts) {
  var def = ruleset.perps[gestalt];
  if (!def) return false;
  var td = def.type_data || {};
  if ((td.required_level || 0) > playerLevel) return false;
  var reqs = td.required_providers || [];
  for (var i = 0; i < reqs.length; i++) {
    if (!ownedGestalts[reqs[i]]) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Implemented handlers
// ---------------------------------------------------------------------------

/**
 * getToken() → Promise<{result: string}>
 * Returns webxdc.selfAddr as the session token.  Game.js threads this value
 * through subsequent handler calls but never inspects it.
 */
export function getToken() {
  // eslint-disable-next-line no-undef
  var addr = (typeof webxdc !== 'undefined') ? webxdc.selfAddr : '';
  return Promise.resolve({ result: addr || 'local' });
}

/**
 * ping() → Promise<{result: "pong"}>
 * RpcQueue keepalive; not auth-gated.
 */
export function ping() {
  return Promise.resolve({ result: 'pong' });
}

/**
 * getSessionLocale() → Promise<{result: string}>
 * Returns locale string; Game.js checks === "de" for branch selection.
 * Defaults to "de" since that is the packaged ruleset.
 */
export function getSessionLocale() {
  var state = getState();
  var locale = (state && state.locale) || 'de';
  return Promise.resolve({ result: locale });
}

/**
 * loadGame(token) → Promise<{result: GameData}>
 *
 * Runs the materializer once against current state, persists the result,
 * builds the response shape expected by GameRoot.prototype.loadGame
 * (Game.js:1876), and schedules socket event emission for any charges that
 * completed during the away window.
 */
export function loadGame(/* token */) {
  var state = getState();
  var now = clockNow();
  var mat = materialize(state, now);
  setState(mat.state);

  var gameData = _buildLoadGameResponse(mat.state, now);

  // Schedule socket event emission via queueMicrotask so it runs after the
  // microtask that resolves the Deferred in Remote.js (result.then → d.resolve
  // → .done() → app.socket.queue.start()).  In practice M1 (this microtask)
  // fires BEFORE M2 (d.resolve), but that is safe: Socket.NEEDS_QUEUE handlers
  // call jqmq.add() on the paused queue — items are buffered, not dropped —
  // and are processed only after queue.start() (Game.js:2072).
  var events = mat.events;
  queueMicrotask(function () {
    for (var i = 0; i < events.length; i++) {
      _emit(events[i].ev, events[i].pl);
    }
  });

  return Promise.resolve({ result: gameData });
}

/**
 * resetGame(token) → Promise<{result: true}>
 *
 * Emits a 'reset' delta that wipes all game state while preserving the
 * player's identity (addr).  Game.js calls location.reload() after this
 * resolves, so the payload is ignored — any 200-truthy value suffices.
 *
 * Cold-start replay note: webxdc update history is append-only, so prior
 * deltas remain in the log.  applyDelta's 'reset' reducer turns them into a
 * no-op prefix.  Compaction is deferred to Phase 7 (#35).
 */
export function resetGame(/* token */) {
  var state = getState();
  var delta = { kind: 'delta', op: 'reset', addr: state.addr, ts: clockNow() };

  // Apply locally so in-memory state is consistent before the page reload.
  setState(applyDelta(state, delta));

  // Broadcast to webxdc update history for durable replay on cold start.
  // eslint-disable-next-line no-undef
  if (typeof webxdc !== 'undefined') {
    webxdc.sendUpdate({ payload: delta }, ''); // eslint-disable-line no-undef
  }

  return Promise.resolve({ result: true });
}

// ---------------------------------------------------------------------------
// Response builder
// ---------------------------------------------------------------------------

function _buildLoadGameResponse(state, now) {
  var ruleset = _getRuleset();

  // type_registry: merged dict of all perp/token/powerup type definitions.
  // Keys are gestalt names (or hash keys for StoryPerps without a gestalt).
  var typeRegistry = Object.assign({}, ruleset.perps, ruleset.tokens, ruleset.powerups);

  // ap_initial / ap_offset are recomputed on read (never stored).
  // After materializer, ap_snapshot already reflects the current AP value.
  var gv = state.game_values || {};
  var gameValues = Object.assign({}, gv, {
    ap_initial: typeof gv.ap_snapshot === 'number' ? gv.ap_snapshot : 0,
    ap_offset: 0
  });

  return {
    version: String(ruleset.version),
    _id: state.addr,
    type_registry: typeRegistry,
    // type_data becomes the GameRoot type_data; levels must be present for
    // GameRoot.getLevelByXP (Game.js:1704).
    type_data: {
      levels: ruleset.levels,
      game_values: gameValues
    },
    user: {
      auth_username: state.addr,
      display_name: state.display_name || ''
    },
    Imperium: {
      game_id: 'Imperium',
      full_path: 'Imperium',
      instance_data: {},
      type_data: {}
    },
    Database: {
      game_id: 'Database',
      full_path: 'Database',
      instance_data: {},
      type_data: {}
    },
    nodes: state.nodes || [],
    nodes_charging: state.nodes_charging || [],
    nodes_collect: state.nodes_collect || [],
    db_queue: state.db_queue || [],
    karmalauters: ruleset.karmalauters,
    karmalizers: ruleset.karmalizers,
    server_time: { $date: now },
    is_new_game: !(state.nodes && state.nodes.length),
    missions: ruleset.missions,
    mission_goals: state.mission_goals || [],
    active_missions: state.active_missions || []
  };
}

export function getProvidedPerps(_token, gnodePath) {
  var state = getState();
  var nodes = (state && state.nodes) || [];
  var maps = _getNodeMaps(nodes);
  var node = maps.paths[gnodePath];
  if (!node) return Promise.resolve({ result: { error: 0 } });

  var gestalt = node.gestalt || _gestaltFrom(node.full_type);
  if (!gestalt) return Promise.resolve({ result: { error: 0 } });

  var ruleset = _getRuleset();
  var def = ruleset.perps[gestalt];
  if (!def) return Promise.resolve({ result: { error: 0 } });

  var provided = (def.type_data && def.type_data.provided_perps) || [];
  var level = (state.game_values && state.game_values.xp_level) || 1;
  var owned = maps.gestalts;

  var buyable = provided.filter(function (g) {
    return _isProvidable(g, ruleset, level, owned);
  });

  return Promise.resolve({ result: { buyable: buyable } });
}

export function getPowerups(_token, projectGestalt /*, version */) {
  var ruleset = _getRuleset();
  var def = ruleset.perps[projectGestalt];
  if (!def) return Promise.resolve({ result: [] });

  var td = def.type_data || {};
  var entries = [].concat(
    td.provided_ads || [],
    td.provided_upgrades || [],
    td.provided_teammembers || []
  );

  var result = [];
  for (var i = 0; i < entries.length; i++) {
    var entry = entries[i];
    var puDef = ruleset.powerups[entry.gestalt];
    if (!puDef) continue;
    result.push({
      game_gestalt: entry.gestalt,
      game_type: puDef.game_type,
      type_data: Object.assign({ gestalt: entry.gestalt }, puDef.type_data, entry)
    });
  }

  return Promise.resolve({ result: result });
}

// ---------------------------------------------------------------------------
// getRanking
// ---------------------------------------------------------------------------

// TODO(#29): Replace with multi-peer aggregation in Phase 6.
export function getRanking(_token, type) {
  var state = getState();
  var gv = (state && state.game_values) || {};
  var fieldMap = {
    cash:     gv.cash_value,
    profiles: gv.profiles_value,
    xp:       gv.xp_value,
    spent:    gv.cash_spent
  };
  var value = fieldMap[type] !== undefined ? fieldMap[type] : 0;
  return Promise.resolve({
    result: {
      top: [{ display_name: (state && state.display_name) || '', value: value, self: true }],
      user_rank: 1
    }
  });
}

// ---------------------------------------------------------------------------
// Delta helpers
// ---------------------------------------------------------------------------

// Persist a delta to the webxdc update history (no-op when webxdc is absent,
// e.g. in Node/vitest).  The reducer in state.js applies the same mutation on
// replay so state survives a reload.
function _sendDelta(addr, op, args, result) {
  // eslint-disable-next-line no-undef
  if (typeof webxdc !== 'undefined') {
    // eslint-disable-next-line no-undef
    webxdc.sendUpdate({
      payload: {
        kind: 'delta',
        addr: addr,
        op: op,
        args: args,
        result: result,
        ts: clockNow()
      }
    }, '');
  }
}

// ---------------------------------------------------------------------------
// Validation helpers (mirrors dd_app helpers.validateDisplayName)
// ---------------------------------------------------------------------------

// Printable Unicode, 1–30 chars; no ASCII control chars (< 0x20) or DEL (0x7f).
var DISPLAY_NAME_RE = /^[^\x00-\x1f\x7f]{1,30}$/;

function validateDisplayName(name) {
  if (typeof name !== 'string') return false;
  return name.trim().length > 0 && DISPLAY_NAME_RE.test(name);
}

// ---------------------------------------------------------------------------
// setDisplayName / setPerpCoordinates (#13)
// ---------------------------------------------------------------------------

/**
 * setDisplayName(token, dname) → Promise<{result: {}|{error:0|1}}>
 *
 * Validates dname (length cap, charset), writes state.user.display_name, and
 * emits a delta so the change survives a reload.
 * Returns {} on success or {error: 0} on bad input / {error: 1} on internal fault.
 */
export function setDisplayName(/* token, */ _, dname) {
  if (!validateDisplayName(dname)) {
    return Promise.resolve({ result: { error: 0 } });
  }

  var state = getState();
  if (!state) {
    return Promise.resolve({ result: { error: 1 } });
  }

  var newState = Object.assign({}, state, { display_name: dname });
  setState(newState);
  _sendDelta(state.addr, 'setDisplayName', [dname], {});

  return Promise.resolve({ result: {} });
}

/**
 * setPerpCoordinates(token, updates) → Promise<{result: 1}>
 *
 * updates = [[full_path, {x, y}], ...]
 * Matches nodes by full_path and $sets instance_data.x / instance_data.y.
 * Emits one delta covering all entries.  Always returns {result: 1} even when
 * some paths are not found (matches original server behaviour: Game.js:981).
 */
export function setPerpCoordinates(/* token, */ _, updates) {
  if (!Array.isArray(updates) || updates.length === 0) {
    return Promise.resolve({ result: 1 });
  }

  var state = getState();
  if (!state || !Array.isArray(state.nodes)) {
    return Promise.resolve({ result: 1 });
  }

  // Build a lookup map: full_path → {x, y}
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
      instance_data: Object.assign({}, node.instance_data, {
        x: pos.x,
        y: pos.y
      })
    });
  });

  var newState = Object.assign({}, state, { nodes: nodes });
  setState(newState);
  _sendDelta(state.addr, 'setPerpCoordinates', [updates], {});

  return Promise.resolve({ result: 1 });
}

// ---------------------------------------------------------------------------
// buyKarma handler
// ---------------------------------------------------------------------------

// Returns the matching level entry (or the last level for XP beyond the cap).
function _findLevelByXP(levels, xp) {
  for (var i = 0; i < levels.length; i++) {
    if (xp >= levels[i].xp_min && xp <= levels[i].xp_max) {
      return levels[i];
    }
  }
  return levels[levels.length - 1];
}

/**
 * buyKarma(token, karmalauterGestalt) → Promise<{result}>
 *
 * Looks up the karmalauter in the ruleset, validates cash, applies increments,
 * and returns {game_values, [levelup]}.  No missions payload (handler-map.md).
 */
export function buyKarma(_token, karmalauterGestalt) {
  var state = getState();
  var ruleset = _getRuleset();

  var karmalauter = null;
  for (var i = 0; i < ruleset.karmalauters.length; i++) {
    if (ruleset.karmalauters[i].type_data.gestalt === karmalauterGestalt) {
      karmalauter = ruleset.karmalauters[i];
      break;
    }
  }
  if (!karmalauter) {
    return Promise.resolve({ result: { error: 1 } });
  }

  var td = karmalauter.type_data;
  var gv = state.game_values;

  if (gv.cash_value < td.price) {
    return Promise.resolve({ result: { error: 2 } });
  }

  var newXp = (gv.xp_value || 0) + td.karma_points;
  var newKarma = Math.min(100, Math.max(-100, (gv.karma_value || 0) + td.karma_points));
  var newCash = gv.cash_value - td.price;
  var newCashSpent = (gv.cash_spent || 0) + td.price;

  var oldLevelNum = gv.xp_level || 1;
  var newLevel = _findLevelByXP(ruleset.levels, newXp);
  var levelup = newLevel.number > oldLevelNum;

  var newGv = Object.assign({}, gv, {
    xp_value: newXp,
    karma_value: newKarma,
    cash_value: newCash,
    cash_spent: newCashSpent,
    xp_level: newLevel.number
  });

  if (levelup) newGv.ap_snapshot = newLevel.ap_max;

  setState(Object.assign({}, state, { game_values: newGv }));
  _sendDelta(state.addr, 'buyKarma', [karmalauterGestalt], { game_values: newGv });

  var response = { game_values: newGv };
  if (levelup) response.levelup = true;
  return Promise.resolve({ result: response });
}

// ---------------------------------------------------------------------------
// Stub handlers — Wave 4+ issues fill these in.
// ---------------------------------------------------------------------------
var _STUBS = [
  'buyPowerup', 'chargePerp', 'collectPerp', 'integrateCollected',
  'buyPerp', 'buySlots', 'sellPowerup', 'checkUsername'
];

var _stubHandlers = {};
_STUBS.forEach(function (name) {
  _stubHandlers[name] = function () {
    return Promise.reject('NotImplemented: ' + name);
  };
});

// ---------------------------------------------------------------------------
// Default export — object consumed by Remote.js via require('LocalEngine').
// Includes setEmitter so app.js can wire the DOM event bus after jQuery loads.
// ---------------------------------------------------------------------------
var LocalEngine = Object.assign({
  getToken: getToken,
  ping: ping,
  getSessionLocale: getSessionLocale,
  loadGame: loadGame,
  getRanking: getRanking,
  resetGame: resetGame,
  setDisplayName: setDisplayName,
  setPerpCoordinates: setPerpCoordinates,
  getProvidedPerps: getProvidedPerps,
  getPowerups: getPowerups,
  buyKarma: buyKarma,
  setEmitter: setEmitter
}, _stubHandlers);

export default LocalEngine;
