// Local replacement for the back-end JSON-RPC service.
// ESM exports — consumed by Remote.js via the AMD bridge in esm-bundle.js.
// No DOM globals in handler bodies; safe to import from Node for tests.
//
// Handlers implemented here: getToken, ping, getSessionLocale, loadGame (#12),
// getRanking, setDisplayName, setPerpCoordinates (#13),
//   getProvidedPerps, getPowerups (#14), buyKarma (#19),
//   buyPowerup, sellPowerup, buySlots (#18), buyPerp (#15),
//   chargePerp (#16), collectPerp, integrateCollected (#17).
// resetGame is intentionally absent — in webxdc, reset = re-share the .xdc.
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

function _gameTypeFrom(fullType) {
  if (!fullType) return '';
  var idx = fullType.indexOf(':');
  return idx >= 0 ? fullType.slice(0, idx) : fullType;
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
// Delta persistence — injected by production boot so webxdc.sendUpdate is
// not imported here.  Tests override with setSendDelta to capture deltas.
// ---------------------------------------------------------------------------
var _sendDelta = null;

export function setSendDelta(fn) {
  _sendDelta = fn;
}

// Single persistence path: capture for tests, then either fire the production
// webxdc.sendUpdate (listener will echo and apply via applyDelta) or, in
// Node/no-webxdc environments, emulate the listener echo synchronously.
// This is the only place outside the listener that calls setState — it IS the
// listener-equivalent for environments without webxdc.
function _persistDelta(delta) {
  if (_sendDelta) _sendDelta(delta);
  // eslint-disable-next-line no-undef
  if (typeof webxdc !== 'undefined') {
    // eslint-disable-next-line no-undef
    webxdc.sendUpdate({ payload: delta }, '');
  } else {
    setState(applyDelta(getState(), delta));
  }
}

// ---------------------------------------------------------------------------
// PRNG helpers — port of chargecollect.py::getVariatedAmount (±5% jitter).
// Seed is derived from (ts, path) so replaying the same delta always produces
// the same charge_result.
// ---------------------------------------------------------------------------
function _djb2(str) {
  var h = 5381;
  for (var i = 0; i < str.length; i++) {
    h = (Math.imul(33, h) ^ str.charCodeAt(i)) >>> 0;
  }
  return h;
}

function _seededRand(seed) {
  var s = (seed >>> 0);
  s = (Math.imul(1664525, s) + 1013904223) >>> 0;
  return s / 0xFFFFFFFF;
}

function _getVariatedAmount(baseAmount, ts, path) {
  var seed = ((ts & 0xFFFFFFFF) ^ _djb2(path)) >>> 0;
  var rand = _seededRand(seed);        // uniform 0..1
  var variation = rand * 0.1 - 0.05;  // map to −0.05…+0.05 (±5%)
  return Math.round(baseAmount * (1 + variation));
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
 * Returns state.locale if persisted, otherwise defaults to "de".
 */
export function getSessionLocale() {
  var state = getState();
  var locale = (state && state.locale) || 'de';
  return Promise.resolve({ result: locale });
}

/**
 * setLocale(localeCode) → Promise<{result: string}>
 *
 * Persists the player's preferred locale shorthand ('de' or 'en') as a delta
 * so the choice survives a page reload.  The caller is responsible for
 * calling location.reload() after this resolves.
 * Invalid locale codes are silently ignored (result still echoes the code).
 */
export function setLocale(localeCode) {
  if (localeCode !== 'de' && localeCode !== 'en') {
    return Promise.resolve({ result: localeCode });
  }

  var state = getState();
  _persistDelta({
    kind: 'delta',
    op: 'setLocale',
    addr: state ? state.addr : '',
    locale: localeCode,
    ts: clockNow()
  });

  return Promise.resolve({ result: localeCode });
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

  // freshState now ships the trunk-mission seed inline, so a player whose
  // node_counter is still 0 has not yet bought anything — that's our
  // "is_new_game" signal for GameRoot.loadGame's scroll-to-top heuristic.
  var isNewGame = !state.node_counter;

  var mat = materialize(state, now);
  // Lazy-seed mission_goals from ruleset for any active mission that hasn't
  // had its goals populated yet (e.g. fresh game, or a mission activated by
  // legacy code that didn't seed goals). This is the prerequisite for
  // mission progression: empty goals → progression handlers no-op.
  var seededState = _seedMissionGoals(mat.state);
  setState(seededState);

  // Re-arm one-shot materializers for any charges still in flight. Clear
  // any prior handles first so calling loadGame twice doesn't queue
  // duplicate node_ready emissions for the same charge.
  _clearAllChargeReady();
  var stillCharging = (seededState && seededState.nodes_charging) || [];
  for (var i = 0; i < stillCharging.length; i++) {
    if (typeof stillCharging[i].charge_end === 'number') {
      _scheduleChargeReady(stillCharging[i].charge_end, stillCharging[i].path);
    }
  }

  var gameData = _buildLoadGameResponse(seededState, now, isNewGame);

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

// ---------------------------------------------------------------------------
// Response builder
// ---------------------------------------------------------------------------

function _buildLoadGameResponse(state, now, isNewGame) {
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
    is_new_game: typeof isNewGame === 'boolean' ? isNewGame : !state.node_counter,
    locale_persisted: !!state.locale,
    missions: ruleset.missions,
    mission_goals: state.mission_goals || [],
    active_missions: state.active_missions || [],
    // Clone the seen-maps so Game.js mutating raw_data.* doesn't poison
    // state.* via shared object reference (which would make
    // dismissMissionBriefing / markTokenSeen think the gestalt is already
    // seen and skip the delta commit, so the dismissal never persists).
    mission_briefings_seen: Object.assign({}, state.mission_briefings_seen || {}),
    tokens_seen: Object.assign({}, state.tokens_seen || {})
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

// Supported sort fields and their key in state.peers[addr].
// Matches val_type strings from docs/handler-map.md §getRanking and the call
// site at Game.js:3352 (Topscore.fetchScore). Includes `spent` (cash_spent)
// for the Investor tab registered in type_settings.js, and `level` as a
// forward-facing field. Unknown types fall back to 'xp' with a console.warn.
var _RANKING_FIELDS = { cash: 1, profiles: 1, xp: 1, level: 1, spent: 1 };

export function getRanking(_token, type) {
  var state = getState();
  var selfAddr = (state && state.addr) || '';
  var peers = (state && state.peers) || {};

  if (!_RANKING_FIELDS[type]) {
    console.warn('[getRanking] unknown type "' + type + '", falling back to xp');
  }
  var field = _RANKING_FIELDS[type] ? type : 'xp';

  var rows = Object.keys(peers).map(function (addr) {
    var p = peers[addr];
    return {
      display_name: p.display_name || addr,
      value: typeof p[field] === 'number' ? p[field] : 0,
      self: addr === selfAddr,
    };
  });

  rows.sort(function (a, b) { return b.value - a.value; });

  var selfIdx = -1;
  for (var i = 0; i < rows.length; i++) {
    if (rows[i].self) { selfIdx = i; break; }
  }

  var n = rows.length;
  var userRank = n === 0 ? 0
    : selfIdx < 0 ? 0
    : n === 1 ? 1
    : 1 - selfIdx / (n - 1);

  return Promise.resolve({ result: { top: rows, user_rank: userRank } });
}

// ---------------------------------------------------------------------------
// Delta helpers
// ---------------------------------------------------------------------------

// Build a canonical delta envelope.  Always paired with _persistDelta — never
// pass the result anywhere else.  Kept as a tiny helper so handler call sites
// don't repeat the kind/ts boilerplate.
function _mkDelta(addr, op, args, result) {
  return {
    kind:   'delta',
    addr:   addr,
    op:     op,
    args:   args,
    result: result,
    ts:     clockNow()
  };
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

  _persistDelta(_mkDelta(state.addr, 'setDisplayName', [dname], {}));

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

  _persistDelta(_mkDelta(state.addr, 'setPerpCoordinates', [updates], {}));

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

  _persistDelta(_mkDelta(state.addr, 'buyKarma', [karmalauterGestalt],
    { game_values: newGv }));

  var response = { game_values: newGv };
  if (levelup) response.levelup = true;
  return Promise.resolve({ result: response });
}

// ---------------------------------------------------------------------------
// Purchase helpers — shared by buyPowerup / sellPowerup / buySlots
// ---------------------------------------------------------------------------

// Looks up a node by full_path and its ruleset type_data.  Returns
// { state, nodeIdx, node, perpTypeData } or null when either is missing.
function _resolveNode(perpPath) {
  var state = getState();
  var nodeIdx = -1;
  for (var i = 0; i < state.nodes.length; i++) {
    if (state.nodes[i].full_path === perpPath) { nodeIdx = i; break; }
  }
  if (nodeIdx === -1) return null;
  var node = state.nodes[nodeIdx];
  var ft = node.full_type || '';
  var colon = ft.indexOf(':');
  var perpGestalt = colon >= 0 ? ft.slice(colon + 1) : (node.gestalt || '');
  var perpTypeDef = _getRuleset().perps[perpGestalt];
  if (!perpTypeDef) return null;
  return { state: state, nodeIdx: nodeIdx, node: node, perpTypeData: perpTypeDef.type_data };
}

// Searches provided_ads / provided_upgrades / provided_teammembers for a
// powerup entry by gestalt.  O(P) where P = total provided entries.
function _findPowerupDef(perpTypeData, powerupGestalt) {
  var lists = [
    perpTypeData.provided_ads,
    perpTypeData.provided_upgrades,
    perpTypeData.provided_teammembers
  ];
  for (var i = 0; i < lists.length; i++) {
    var list = lists[i] || [];
    for (var j = 0; j < list.length; j++) {
      if (list[j].gestalt === powerupGestalt) return list[j];
    }
  }
  return null;
}

// Recomputes charge_cost / collect_amount / collect_risk from the perp's
// base type_data values plus the cumulative modifiers of all active powerups.
// Pre-indexes provided_* lists into a map so the powerup loop is O(N) not O(N×P).
function _computeModifiers(perpTypeData, powerups) {
  var defByGestalt = {};
  var provided = [perpTypeData.provided_ads, perpTypeData.provided_upgrades, perpTypeData.provided_teammembers];
  for (var k = 0; k < provided.length; k++) {
    var list = provided[k] || [];
    for (var j = 0; j < list.length; j++) { defByGestalt[list[j].gestalt] = list[j]; }
  }
  var chargeCost = perpTypeData.charge_cost || 0;
  var collectAmount = perpTypeData.collect_amount || 0;
  var collectRisk = perpTypeData.collect_risk || 0;
  for (var i = 0; i < powerups.length; i++) {
    var puDef = defByGestalt[powerups[i].gestalt];
    if (puDef) {
      chargeCost    += puDef.charge_cost_modifier    || 0;
      collectAmount += puDef.collect_amount_modifier || 0;
      collectRisk   += puDef.collect_risk_modifier   || 0;
    }
  }
  return { charge_cost: chargeCost, collect_amount: collectAmount, collect_risk: collectRisk };
}

function _getLevelByXP(xp) {
  var levels = _getRuleset().levels;
  for (var i = 0; i < levels.length; i++) {
    if (xp >= levels[i].xp_min && xp <= levels[i].xp_max) return levels[i].number;
  }
  return levels[levels.length - 1].number;
}

function _checkLevelup(currentLevel, newXp) {
  return _getLevelByXP(newXp) > currentLevel;
}

// All delta-emitting handlers funnel through _persistDelta (above). The legacy
// _commitDelta(computedNewState, addr, op, args, result) entry point that
// did setState(computedNewState) on the no-webxdc branch is gone — the
// reducer in scripts/state.js is now the sole transformation, applied via
// applyDelta in the listener (production) or in _persistDelta's fallback.

// ---------------------------------------------------------------------------
// buyPowerup(token, perpPath, slot, gestalt)
// ---------------------------------------------------------------------------

/**
 * buyPowerup — push a powerup into a slot on a project node.
 *
 * Validates: cash >= powerup price AND slot is empty.
 * Errors: 0 = node/type not found, 1 = slot occupied, 3 = insufficient cash.
 * Returns: { node, game_values, levelup }
 */
export function buyPowerup(token, perpPath, slot, gestalt) {
  var r = _resolveNode(perpPath);
  if (!r) return Promise.resolve({ result: { error: 0 } });
  var state = r.state, nodeIdx = r.nodeIdx, node = r.node, perpTypeData = r.perpTypeData;

  var puDef = _findPowerupDef(perpTypeData, gestalt);
  if (!puDef) return Promise.resolve({ result: { error: 0 } });

  var powerups = node.instance_data.powerups || [];
  var puGameType = _gameTypeFrom(puDef.full_type);
  for (var i = 0; i < powerups.length; i++) {
    if (powerups[i].slot === slot && _gameTypeFrom(powerups[i].full_type) === puGameType) {
      return Promise.resolve({ result: { error: 1 } });
    }
  }

  var price = puDef.price || 0;
  if (state.game_values.cash_value < price) return Promise.resolve({ result: { error: 3 } });

  var newPowerups = powerups.concat([{ slot: slot, gestalt: gestalt, full_type: puDef.full_type }]);
  var mods = _computeModifiers(perpTypeData, newPowerups);

  var newInstanceData = Object.assign({}, node.instance_data, {
    powerups:       newPowerups,
    charge_cost:    mods.charge_cost,
    collect_amount: mods.collect_amount,
    collect_risk:   mods.collect_risk,
    tokens:         perpTypeData.tokens || []
  });

  var newXp = state.game_values.xp_value + (perpTypeData.xp_inc || 1);
  var levelup = _checkLevelup(state.game_values.xp_level, newXp);

  var newGameValues = Object.assign({}, state.game_values, {
    cash_value:  state.game_values.cash_value - price,
    cash_spent:  (state.game_values.cash_spent  || 0) + price,
    xp_value:    newXp,
    karma_value: (state.game_values.karma_value || 0) + 1
  });
  if (levelup) newGameValues.xp_level = _getLevelByXP(newXp);

  var newNodes = state.nodes.slice();
  newNodes[nodeIdx] = Object.assign({}, node, { instance_data: newInstanceData });

  var preMissionStatePu = Object.assign({}, state, { nodes: newNodes, game_values: newGameValues });
  var puMissionResult = _advanceBuyPowerupMissions(preMissionStatePu, gestalt);
  newGameValues = _applyRewardsToGv(newGameValues, puMissionResult.rewards);

  var responseNode = {
    game_id: node.game_id, game_type: node.game_type,
    full_path: node.full_path, instance_data: newInstanceData
  };
  var result = { node: responseNode, game_values: newGameValues, levelup: levelup,
                 missions: puMissionResult.missions || null };

  _persistDelta(_mkDelta(state.addr, 'buyPowerup',
    [token, perpPath, slot, gestalt], result));

  return Promise.resolve({ result: result });
}

// ---------------------------------------------------------------------------
// sellPowerup(token, perpPath, slot, gestalt)
// ---------------------------------------------------------------------------

/**
 * sellPowerup — remove a powerup from a slot, refunding 0.75× the price.
 *
 * Validates: slot is occupied.
 * Errors: 0 = node/type not found, 1 = slot not occupied.
 * Returns: { node, game_values, levelup }
 */
export function sellPowerup(token, perpPath, slot, gestalt) {
  var r = _resolveNode(perpPath);
  if (!r) return Promise.resolve({ result: { error: 0 } });
  var state = r.state, nodeIdx = r.nodeIdx, node = r.node, perpTypeData = r.perpTypeData;

  var powerups = node.instance_data.powerups || [];
  var puEntry = null;
  for (var i = 0; i < powerups.length; i++) {
    if (powerups[i].slot === slot) { puEntry = powerups[i]; break; }
  }
  if (!puEntry) return Promise.resolve({ result: { error: 1 } });

  var puDef = _findPowerupDef(perpTypeData, puEntry.gestalt);
  var price = puDef ? (puDef.price || 0) : 0;
  var refund = Math.floor(price * 0.75);

  var newPowerups = powerups.filter(function (p) { return p.slot !== slot; });
  var mods = _computeModifiers(perpTypeData, newPowerups);

  var newInstanceData = Object.assign({}, node.instance_data, {
    powerups:       newPowerups,
    charge_cost:    mods.charge_cost,
    collect_amount: mods.collect_amount,
    collect_risk:   mods.collect_risk,
    tokens:         perpTypeData.tokens || []
  });

  var newXp = state.game_values.xp_value + 1;
  var levelup = _checkLevelup(state.game_values.xp_level, newXp);

  var newGameValues = Object.assign({}, state.game_values, {
    cash_value: state.game_values.cash_value + refund,
    xp_value:   newXp
  });
  if (levelup) newGameValues.xp_level = _getLevelByXP(newXp);

  var newNodes = state.nodes.slice();
  newNodes[nodeIdx] = Object.assign({}, node, { instance_data: newInstanceData });

  var responseNode = {
    game_id: node.game_id, game_type: node.game_type,
    full_path: node.full_path, instance_data: newInstanceData
  };
  var result = { node: responseNode, game_values: newGameValues, levelup: levelup };

  _persistDelta(_mkDelta(state.addr, 'sellPowerup',
    [token, perpPath, slot, gestalt], result));

  return Promise.resolve({ result: result });
}

// ---------------------------------------------------------------------------
// buySlots(token, perpPath, slot_type, num)
// ---------------------------------------------------------------------------

/**
 * buySlots — purchase additional powerup/ad/upgrade/teammember slots.
 *
 * Validates: cash >= total slot cost.
 * Cost per slot: slot_cost + slot_cost_modifier * (current_slots + i).
 * Errors: 0 = node/type not found, 2 = would exceed max slots, 3 = no cash.
 * Returns: { node, game_values, levelup }
 */
export function buySlots(token, perpPath, slotType, num) {
  num = parseInt(num, 10) || 1;
  var r = _resolveNode(perpPath);
  if (!r) return Promise.resolve({ result: { error: 0 } });
  var state = r.state, nodeIdx = r.nodeIdx, node = r.node, perpTypeData = r.perpTypeData;
  var slotKey = slotType + '_slots';
  var maxKey  = 'max_' + slotType + '_slots';

  var currentSlots = (node.instance_data[slotKey] !== undefined)
    ? node.instance_data[slotKey]
    : (perpTypeData[slotKey] || 0);
  var maxSlots = perpTypeData[maxKey] != null ? perpTypeData[maxKey] : Infinity;

  if (currentSlots + num > maxSlots) return Promise.resolve({ result: { error: 2 } });

  var slotCost = perpTypeData.slot_cost || 0;
  var slotCostModifier = perpTypeData.slot_cost_modifier || 0;
  var totalCost = 0;
  for (var i = 0; i < num; i++) {
    totalCost += slotCost + slotCostModifier * (currentSlots + i);
  }

  if (state.game_values.cash_value < totalCost) return Promise.resolve({ result: { error: 3 } });

  var newInstanceData = Object.assign({}, node.instance_data);
  newInstanceData[slotKey] = currentSlots + num;

  var newXp = state.game_values.xp_value + 1;
  var levelup = _checkLevelup(state.game_values.xp_level, newXp);

  var newGameValues = Object.assign({}, state.game_values, {
    cash_value: state.game_values.cash_value - totalCost,
    cash_spent: (state.game_values.cash_spent || 0) + totalCost,
    xp_value:   newXp
  });
  if (levelup) newGameValues.xp_level = _getLevelByXP(newXp);

  var newNodes = state.nodes.slice();
  newNodes[nodeIdx] = Object.assign({}, node, { instance_data: newInstanceData });

  var responseNode = {
    game_id: node.game_id, game_type: node.game_type,
    full_path: node.full_path, instance_data: newInstanceData
  };
  var result = { node: responseNode, game_values: newGameValues, levelup: levelup };

  _persistDelta(_mkDelta(state.addr, 'buySlots',
    [token, perpPath, slotType, num], result));

  return Promise.resolve({ result: result });
}

// ---------------------------------------------------------------------------
// buyPerp — first non-trivial purchase handler (#15)
// ---------------------------------------------------------------------------

/**
 * buyPerp(token, parentPath, gestalt) → Promise<{result: BuyPerpResult}>
 *
 * Port of dd_app views.py:1001.  Single-tenant — no concurrent-writer guards.
 *
 * Error codes (mirrors original):
 *   1 — gestalt unknown / level too low / parent slot list excludes gestalt / dup
 *   2 — insufficient cash
 *   3 — ProxyPerp slot limit reached
 *   4 — already purchased under this parent
 */
export function buyPerp(_token, parentPath, gestalt) {
  var state = getState();
  var ruleset = _getRuleset();
  var allTypes = Object.assign({}, ruleset.perps, ruleset.tokens);

  var perpDef = allTypes[gestalt];
  if (!perpDef) { return Promise.resolve({ result: { error: 1 } }); }
  var typeData = perpDef.type_data || {};
  var gameType = perpDef.game_type;

  var gv = state.game_values || {};
  var currentLevel = gv.xp_level || 1;
  var requiredLevel = typeData.required_level != null ? typeData.required_level : 1;
  if (currentLevel < requiredLevel) { return Promise.resolve({ result: { error: 1 } }); }

  // Roots ("Imperium", "Database") are always valid.  Other paths are checked
  // against state.nodes; if not found we still allow the call (single-tenant,
  // client already guards this) so that pre-loaded seed nodes don't block buys.
  var parentNode = null;
  if (parentPath !== 'Imperium' && parentPath !== 'Database') {
    var nodes = state.nodes || [];
    for (var ni = 0; ni < nodes.length; ni++) {
      if (nodes[ni].full_path === parentPath) { parentNode = nodes[ni]; break; }
    }
  }

  // Only validate provided_perps when we can resolve the parent's type definition.
  var parentGestalt = parentNode ? (parentNode.gestalt || '') : '';
  var parentTypeDef = parentGestalt ? allTypes[parentGestalt] : null;
  var parentTypeData = parentTypeDef ? (parentTypeDef.type_data || {}) : null;

  if (parentTypeData && Array.isArray(parentTypeData.provided_perps)) {
    if (parentTypeData.provided_perps.indexOf(gestalt) === -1) {
      return Promise.resolve({ result: { error: 1 } });
    }
  }

  if (parentNode && parentNode.game_type === 'ProxyPerp') {
    var maxSlots = (parentTypeData && parentTypeData.max_slots) || 0;
    var childPrefix = parentPath + '.';
    var childCount = 0;
    var allNodes = state.nodes || [];
    for (var ci = 0; ci < allNodes.length; ci++) {
      if (allNodes[ci].full_path.indexOf(childPrefix) === 0) { childCount++; }
    }
    if (childCount >= maxSlots) { return Promise.resolve({ result: { error: 3 } }); }
  }

  var price = typeof typeData.price === 'number' ? typeData.price : 0;
  if (gv.cash_value < price) { return Promise.resolve({ result: { error: 2 } }); }

  var newFullPath = parentPath + '.' + gestalt;
  var stateNodes = state.nodes || [];
  for (var di = 0; di < stateNodes.length; di++) {
    if (stateNodes[di].full_path === newFullPath) {
      return Promise.resolve({ result: { error: 4 } });
    }
  }

  var nodeCounter = (state.node_counter || 0) + 1;
  var newNode = {
    // game_id == gestalt (last path segment); see _seedNodesFromTree for invariant.
    game_id: gestalt,
    game_type: gameType,
    full_type: gameType + ':' + gestalt,
    gestalt: gestalt,
    full_path: newFullPath,
    instance_data: {}
  };

  var xpInc = typeof typeData.xp_inc === 'number' ? typeData.xp_inc : 0;
  var profilesMaxInc = typeof typeData.profiles_max === 'number' ? typeData.profiles_max : 0;
  var newGv = Object.assign({}, gv, {
    cash_value: gv.cash_value - price,
    cash_spent: (gv.cash_spent || 0) + price,
    xp_value: (gv.xp_value || 0) + xpInc,
    profiles_max: (gv.profiles_max || 0) + profilesMaxInc
  });

  var oldLevel = gv.xp_level || 1;
  var newLevel = _getLevelByXP(newGv.xp_value);
  var levelup = newLevel > oldLevel;
  if (levelup) {
    newGv = Object.assign({}, newGv, { xp_level: newLevel });
    var levelInfo = ruleset.levels[newLevel - 1];
    if (levelInfo) {
      newGv = Object.assign({}, newGv, {
        ap_inc_value: levelInfo.ap_inc_value,
        ap_inc_interval: levelInfo.ap_inc_interval,
        ap_max: levelInfo.ap_max,
        // Refill AP on levelup so the player gets a fresh batch of actions —
        // matches buyKarma/chargePerp behaviour. Without this, ap_snapshot
        // stayed at the previous level's value while ap_max grew, so the AP
        // bar visibly under-filled after a buyPerp-triggered level.
        ap_snapshot: levelInfo.ap_max
      });
    }
  }

  var missionResult = _advanceBuyPerpMissions(state, gestalt);
  newGv = _applyRewardsToGv(newGv, missionResult.rewards);

  // profile_set for project*/contact*/city* gestalts:
  // initial data batch pushed to db_queue; city-buy path also read by Game.js:3816.
  var profileSetPayload = null;
  var newDbQueue = (state.db_queue || []).slice();
  var isProfileGestalt = (
    gestalt.indexOf('project') === 0 ||
    gestalt.indexOf('contact') === 0 ||
    gestalt.indexOf('city') === 0
  );
  if (isProfileGestalt) {
    var collectId = 'cq_' + nodeCounter;
    var tokensMap = {};
    var tokList = typeData.tokens || [];
    for (var ti = 0; ti < tokList.length; ti++) {
      tokensMap[tokList[ti].gestalt] = { amount: tokList[ti].amount };
    }
    var profilesValue = typeof typeData.profileset_size === 'number'
      ? typeData.profileset_size
      : (typeof typeData.collect_amount === 'number' ? typeData.collect_amount : 0);
    var generatedProfileSet = { profiles_value: profilesValue, tokens_map: tokensMap };
    profileSetPayload = { profile_set: generatedProfileSet, origin: newFullPath, collect_id: collectId };
    newDbQueue = newDbQueue.concat([{ origin: newFullPath, collect_id: collectId, profile_set: generatedProfileSet }]);
  }

  var payload = { node: newNode, game_values: newGv, levelup: levelup,
                  node_counter: nodeCounter,
                  missions: missionResult.missions || null };
  if (profileSetPayload) { payload.profile_set = profileSetPayload; }

  _persistDelta(_mkDelta(state.addr, 'buyPerp', [parentPath, gestalt], payload));

  return Promise.resolve({ result: payload });
}

function _findMissionDef(ruleset, gestalt) {
  if (!ruleset || !ruleset.missions || !gestalt) return null;
  for (var i = 0; i < ruleset.missions.length; i++) {
    var def = ruleset.missions[i];
    if (def && def.type_data && def.type_data.gestalt === gestalt) return def;
  }
  return null;
}

// Canonical mission-goal row shape. One source so adding a field touches one place.
function _seedGoalRow(missionGestalt, g) {
  return {
    mission: missionGestalt,
    workflow: g.workflow,
    target: g.target,
    amount: g.amount,
    position: g.position,
    current_amount: 0,
    complete: false
  };
}

function _completeGoal(goal) {
  return Object.assign({}, goal, { complete: true, current_amount: goal.amount || 1 });
}

// Returns the same array reference when nothing changed so callers can use
// reference equality to detect whether any repairs were made.
function _autoCompleteBuyPerpGoals(goals, nodes) {
  var owned = {};
  (nodes || []).forEach(function (n) { if (n.gestalt) owned[n.gestalt] = true; });
  var changed = false;
  var result = goals.map(function (g) {
    if (g.workflow !== 'buy_perp' || g.complete || !owned[g.target]) return g;
    changed = true;
    return _completeGoal(g);
  });
  return changed ? result : goals;
}

// Without this, fresh games (or saves activated by legacy code) have empty
// mission_goals and progression handlers find nothing to advance.
function _seedMissionGoals(state) {
  var activeMissions = state.active_missions || [];
  if (!activeMissions.length) return state;
  var ruleset = _getRuleset();
  if (!ruleset || !ruleset.missions) return state;

  var existingGoals = state.mission_goals || [];
  var existingByMission = {};
  existingGoals.forEach(function (g) {
    existingByMission[g.mission] = true;
  });

  var newGoals = existingGoals.slice();
  var added = false;
  activeMissions.forEach(function (mGestalt) {
    if (existingByMission[mGestalt]) return;
    var mDef = _findMissionDef(ruleset, mGestalt);
    if (!mDef || !mDef.type_data || !mDef.type_data.goals) return;
    mDef.type_data.goals.forEach(function (g) {
      newGoals.push(_seedGoalRow(mGestalt, g));
      added = true;
    });
  });

  // Repair stuck buy_perp goals for items the player already owns — covers
  // both newly seeded goals and goals seeded before a prior session ended.
  var repairedGoals = _autoCompleteBuyPerpGoals(newGoals, state.nodes);
  if (!added && repairedGoals === newGoals) return state;
  return Object.assign({}, state, { mission_goals: repairedGoals });
}

// current_amount math mirrors TokenPerp.setAmount → DBTokensAbsolute
// (Game.js:5439) so the LocalEngine and UI agree on completion.
function _advanceIntegrateProfilesMissions(state, profilesValue, nodes) {
  var goals = state.mission_goals || [];
  var activeMissions = state.active_missions || [];
  if (!goals.length || !activeMissions.length) {
    return { missions: null, mission_goals: goals, active_missions: activeMissions };
  }

  var amountByGestalt = {};
  (nodes || []).forEach(function (n) {
    if (n.game_type === 'TokenPerp' && n.gestalt && n.instance_data) {
      amountByGestalt[n.gestalt] = n.instance_data.amount || 0;
    }
  });

  var changed = false;
  var updatedGoals = goals.map(function (goal) {
    if (goal.workflow !== 'integrate_profiles' || goal.complete) return goal;
    if (activeMissions.indexOf(goal.mission) === -1) return goal;
    var pct = amountByGestalt[goal.target] || 0;
    var absoluteAmount = Math.floor((profilesValue * pct) / 100);
    // Monotonic — never let a later integrate roll back progress (e.g. if
    // profiles_value drops or coverage decays, mission progress sticks).
    var newAmount = Math.max(goal.current_amount || 0, Math.min(absoluteAmount, goal.amount));
    if (newAmount === goal.current_amount) return goal;
    changed = true;
    return Object.assign({}, goal, {
      current_amount: newAmount,
      complete: newAmount >= goal.amount
    });
  });

  if (!changed) {
    return { missions: null, mission_goals: goals, active_missions: activeMissions };
  }

  return _completeMissionsIfReady(updatedGoals, activeMissions);
}

function _advanceCollectProfilesMissions(state, contactGestalt, profilesCollected) {
  var goals = state.mission_goals || [];
  var activeMissions = state.active_missions || [];
  if (!goals.length || !activeMissions.length || !profilesCollected || !contactGestalt) {
    return { missions: null, mission_goals: goals, active_missions: activeMissions };
  }

  var changed = false;
  var updatedGoals = goals.map(function (goal) {
    if (goal.workflow !== 'collect_profiles' || goal.complete) return goal;
    if (goal.target !== contactGestalt) return goal;
    if (activeMissions.indexOf(goal.mission) === -1) return goal;
    var newAmount = Math.min((goal.current_amount || 0) + profilesCollected, goal.amount);
    if (newAmount === goal.current_amount) return goal;
    changed = true;
    return Object.assign({}, goal, {
      current_amount: newAmount,
      complete: newAmount >= goal.amount
    });
  });

  if (!changed) {
    return { missions: null, mission_goals: goals, active_missions: activeMissions };
  }

  return _completeMissionsIfReady(updatedGoals, activeMissions);
}

function _completeMissionsIfReady(updatedGoals, activeMissions) {
  var ruleset = _getRuleset();
  var completed = [];
  var stillActive = activeMissions.filter(function (mGestalt) {
    var goals = updatedGoals.filter(function (g) { return g.mission === mGestalt; });
    if (!goals.length) return true;
    if (goals.every(function (g) { return g.complete; })) {
      completed.push(mGestalt);
      return false;
    }
    return true;
  });

  var newActive = stillActive.slice();
  if (ruleset && ruleset.missions && completed.length) {
    ruleset.missions.forEach(function (def) {
      if (!def || !def.type_data) return;
      var req = def.type_data.required_mission;
      var gestalt = def.type_data.gestalt;
      if (!req || !gestalt || newActive.indexOf(gestalt) !== -1) return;
      if (completed.indexOf(req) === -1) return;
      newActive.push(gestalt);
      (def.type_data.goals || []).forEach(function (g) {
        updatedGoals = updatedGoals.concat([_seedGoalRow(gestalt, g)]);
      });
    });
    // Auto-complete buy_perp goals for items the player already owns so a
    // mission that unlocks after the item was bought doesn't get stuck.
    updatedGoals = _autoCompleteBuyPerpGoals(updatedGoals, getState().nodes);
  }

  var updatedMissions = activeMissions.filter(function (m) {
    var goals = updatedGoals.filter(function (g) { return g.mission === m; });
    return goals.some(function (g) { return g.current_amount > 0 || g.complete; });
  });

  return {
    missions: {
      complete_missions: completed,
      updated_missions: updatedMissions,
      mission_data: {
        active_missions: newActive,
        mission_goals: updatedGoals
      }
    },
    rewards: _collectMissionRewards(ruleset, completed),
    mission_goals: updatedGoals,
    active_missions: newActive
  };
}

// Sums up cash / xp / karma rewards across the just-completed missions so
// the caller can fold them into the new game_values. Without this, mission
// completion notifications fire but the player never sees the payout.
function _collectMissionRewards(ruleset, completedGestalts) {
  var totals = { cash_value: 0, xp_value: 0, karma_value: 0, profiles_max: 0 };
  if (!completedGestalts.length || !ruleset || !ruleset.missions) return totals;
  completedGestalts.forEach(function (mGestalt) {
    var def = _findMissionDef(ruleset, mGestalt);
    var rewards = (def && def.type_data && def.type_data.rewards) || [];
    rewards.forEach(function (r) {
      if (!r || typeof r.amount !== 'number') return;
      if (Object.prototype.hasOwnProperty.call(totals, r.target)) {
        totals[r.target] += r.amount;
      }
    });
  });
  return totals;
}

// Folds reward totals into a fresh game_values object, clamping karma to
// [-100, 100] to match the integrate/karmalizer math.
function _applyRewardsToGv(gv, rewards) {
  if (!rewards) return gv;
  return Object.assign({}, gv, {
    cash_value:   (gv.cash_value   || 0) + (rewards.cash_value   || 0),
    xp_value:     (gv.xp_value     || 0) + (rewards.xp_value     || 0),
    karma_value:  Math.max(-100, Math.min(100,
                  (gv.karma_value  || 0) + (rewards.karma_value || 0))),
    profiles_max: (gv.profiles_max || 0) + (rewards.profiles_max || 0)
  });
}

function _advanceChargePerpMissions(state, gestalt) {
  var activeMissions = state.active_missions || [];
  var missionGoals = state.mission_goals || [];

  if (!activeMissions.length || !missionGoals.length) {
    return { missions: null, mission_goals: missionGoals, active_missions: activeMissions };
  }

  var changed = false;
  var updatedGoals = missionGoals.map(function (goal) {
    if (goal.workflow !== 'charge_perp' || goal.complete) return goal;
    if (goal.target !== gestalt) return goal;
    if (activeMissions.indexOf(goal.mission) === -1) return goal;
    changed = true;
    return _completeGoal(goal);
  });

  if (!changed) {
    return { missions: null, mission_goals: missionGoals, active_missions: activeMissions };
  }

  return _completeMissionsIfReady(updatedGoals, activeMissions);
}

function _advanceBuyPowerupMissions(state, powerupGestalt) {
  var activeMissions = state.active_missions || [];
  var missionGoals = state.mission_goals || [];

  if (!activeMissions.length || !missionGoals.length) {
    return { missions: null, mission_goals: missionGoals, active_missions: activeMissions };
  }

  var changed = false;
  var updatedGoals = missionGoals.map(function (goal) {
    if (goal.workflow !== 'buy_powerup' || goal.complete) return goal;
    if (goal.target !== powerupGestalt) return goal;
    if (activeMissions.indexOf(goal.mission) === -1) return goal;
    changed = true;
    return _completeGoal(goal);
  });

  if (!changed) {
    return { missions: null, mission_goals: missionGoals, active_missions: activeMissions };
  }

  return _completeMissionsIfReady(updatedGoals, activeMissions);
}

function _advanceUpgradeTokenMissions(state, tokenGestalt) {
  var activeMissions = state.active_missions || [];
  var missionGoals = state.mission_goals || [];

  if (!activeMissions.length || !missionGoals.length) {
    return { missions: null, mission_goals: missionGoals, active_missions: activeMissions };
  }

  var changed = false;
  var updatedGoals = missionGoals.map(function (goal) {
    if (goal.workflow !== 'upgrade_token' || goal.complete) return goal;
    if (goal.target !== tokenGestalt) return goal;
    if (activeMissions.indexOf(goal.mission) === -1) return goal;
    changed = true;
    return _completeGoal(goal);
  });

  if (!changed) {
    return { missions: null, mission_goals: missionGoals, active_missions: activeMissions };
  }

  return _completeMissionsIfReady(updatedGoals, activeMissions);
}

/**
 * Advance any active mission goals that have workflow==='buy_perp' and
 * target===gestalt.  Pure; does not mutate state.
 */
function _advanceBuyPerpMissions(state, gestalt) {
  var activeMissions = state.active_missions || [];
  var missionGoals = state.mission_goals || [];

  if (!activeMissions.length || !missionGoals.length) {
    return { missions: null, mission_goals: missionGoals, active_missions: activeMissions };
  }

  var changed = false;
  var updatedGoals = missionGoals.map(function (goal) {
    if (goal.workflow === 'buy_perp' && goal.target === gestalt && !goal.complete) {
      changed = true;
      return _completeGoal(goal);
    }
    return goal;
  });

  if (!changed) {
    return { missions: null, mission_goals: missionGoals, active_missions: activeMissions };
  }

  return _completeMissionsIfReady(updatedGoals, activeMissions);
}

function _advanceCollectCashMissions(state, gestalt, cashGain) {
  var activeMissions = state.active_missions || [];
  var missionGoals = state.mission_goals || [];

  if (!activeMissions.length || !missionGoals.length || !cashGain || !gestalt) {
    return { missions: null, mission_goals: missionGoals, active_missions: activeMissions };
  }

  var changed = false;
  var updatedGoals = missionGoals.map(function (goal) {
    if (goal.workflow !== 'collect_cash' || goal.complete) return goal;
    if (goal.target !== gestalt) return goal;
    if (activeMissions.indexOf(goal.mission) === -1) return goal;
    var newAmount = Math.min((goal.current_amount || 0) + cashGain, goal.amount);
    if (newAmount === goal.current_amount) return goal;
    changed = true;
    return Object.assign({}, goal, {
      current_amount: newAmount,
      complete: newAmount >= goal.amount
    });
  });

  if (!changed) {
    return { missions: null, mission_goals: missionGoals, active_missions: activeMissions };
  }

  return _completeMissionsIfReady(updatedGoals, activeMissions);
}

// ---------------------------------------------------------------------------
// chargePerp — Phase 3 (#16)
// ---------------------------------------------------------------------------

export function chargePerp(token, path) { // eslint-disable-line no-unused-vars
  var rawState = getState();
  var now      = clockNow();
  var ruleset  = _getRuleset();

  // Materialize before reading game_values so AP regen ticks accumulated
  // since the last handler call are visible. Without this, the UI's
  // APTicker can show 1 AP while state.ap_snapshot still says 0, and
  // chargePerp would refuse the action despite the visible bar.
  var mat   = materialize(rawState, now);
  var state = mat.state;

  var nodes   = state.nodes || [];
  var nodeIdx = -1;
  for (var i = 0; i < nodes.length; i++) {
    if (nodes[i].full_path === path) { nodeIdx = i; break; }
  }
  if (nodeIdx < 0) return Promise.resolve({ result: { error: 1 } });

  var node    = nodes[nodeIdx];
  var gestalt = node.gestalt || _gestaltFrom(node.full_type);
  var perpDef  = gestalt && (ruleset.perps[gestalt] || ruleset.tokens[gestalt]);
  var typeData = perpDef && perpDef.type_data;
  if (!typeData || typeof typeData.charge_time !== 'number') {
    return Promise.resolve({ result: { error: 1 } });
  }

  var charging = state.nodes_charging || [];
  for (var j = 0; j < charging.length; j++) {
    if (charging[j].path === path) return Promise.resolve({ result: { error: 2 } });
  }

  var gv           = state.game_values || {};
  var instanceData = node.instance_data || {};
  // charge_cost: instance_data wins (powerup-modified), then type_data, then 0.
  var chargeCost = typeof instanceData.charge_cost === 'number'
    ? instanceData.charge_cost
    : (typeof typeData.charge_cost === 'number' ? typeData.charge_cost : 0);

  // Distinct codes (1=AP, 3=cash) let Game.js show the correct feedback animation.
  if ((gv.ap_snapshot || 0) < 1)           return Promise.resolve({ result: { error: 1 } });
  if ((gv.cash_value  || 0) < chargeCost)  return Promise.resolve({ result: { error: 3 } });

  // ClientPerps don't carry collect_amount in the ruleset — they ship
  // income_base / income_factor instead. Fall back so charging the car
  // company actually pays out when collected. (Income_factor / consumed-
  // tokens scaling is a separate enhancement; this gives the base payout.)
  var baseAmount = typeof instanceData.collect_amount === 'number'
    ? instanceData.collect_amount
    : (typeof typeData.collect_amount === 'number' ? typeData.collect_amount
      : (typeof typeData.income_base   === 'number' ? typeData.income_base   : 0));
  var chargeResult = { amount: _getVariatedAmount(baseAmount, now, path) };

  var durationMs  = typeData.charge_time;
  var chargeEntry = {
    path:         path,
    result:       chargeResult,
    charge_start: now,
    charge_end:   now + durationMs,
    game_id:      node.game_id   || path,
    game_type:    node.game_type || '',
  };

  var xpInc = typeof typeData.xp_inc === 'number' ? typeData.xp_inc : 0;

  // mirrors dd_app views.py:776: $set charge_start, $addToSet nodes_charging,
  // $inc cash_value/cash_spent/xp_value, $dec ap_snapshot
  var newNodes = nodes.map(function(n, idx) {
    if (idx !== nodeIdx) return n;
    return Object.assign({}, n, {
      instance_data: Object.assign({}, n.instance_data, { charge_start: now })
    });
  });

  var newGv = Object.assign({}, gv, {
    cash_value:  (gv.cash_value  || 0) - chargeCost,
    cash_spent:  (gv.cash_spent  || 0) + chargeCost,
    xp_value:    (gv.xp_value   || 0) + xpInc,
    ap_snapshot: Math.max(0, (gv.ap_snapshot || 0) - 1),
  });

  // Advance xp_level if the new XP crossed a threshold. The legacy port
  // omitted this for chargePerp specifically (collectPerp / integrateCollected
  // / buyKarma all do compute it), so the player's XP could drift past
  // xp_level.xp_max — visible as a status-bar overflow on screen.
  var oldLevelNum = gv.xp_level || 1;
  var newLevelNum = _getLevelByXP(newGv.xp_value);
  var levelup = newLevelNum > oldLevelNum;
  if (levelup) {
    var levels = _getRuleset().levels;
    var newLevelInfo = levels[newLevelNum - 1] || levels[levels.length - 1];
    newGv = Object.assign({}, newGv, {
      xp_level: newLevelNum,
      ap_snapshot: newLevelInfo.ap_max,
    });
  }

  var preMissionStateCharge = Object.assign({}, state, {
    nodes:          newNodes,
    nodes_charging: charging.concat([chargeEntry]),
    game_values:    newGv,
  });

  var chargeMissionResult = _advanceChargePerpMissions(preMissionStateCharge, gestalt);
  newGv = _applyRewardsToGv(newGv, chargeMissionResult.rewards);

  // Carry the post-mutation game_values snapshot in the delta so the reducer
  // applies via Object.assign — idempotent under self-echo. Legacy fields
  // (cashDelta, xpInc) stay so already-persisted pre-fix deltas still replay
  // correctly on cold start.
  _persistDelta(_mkDelta(state.addr, 'chargePerp', [path], {
    chargeEntry:  chargeEntry,
    nodeIdx:      nodeIdx,
    cashDelta:    chargeCost,
    xpInc:        xpInc,
    game_values:  newGv,
    missions:     chargeMissionResult.missions || null
  }));

  // Live-tick: nothing in the page periodically calls materialize(), so
  // without this the charge ripens silently — the perp's UI blinks at zero
  // but no node_ready fires until the player reloads (which runs materialize
  // on cold-start). Schedule a one-shot materialize at exactly charge_end.
  _scheduleChargeReady(chargeEntry.charge_end, chargeEntry.path);

  return Promise.resolve({
    result: { game_values: newGv, duration: durationMs, levelup: levelup,
              missions: chargeMissionResult.missions || {} },
  });
}

// Active charge-ready timers, keyed by path. Tracking lets us clear stale
// handles before re-scheduling — e.g. when loadGame replays history we
// re-arm every in-flight charge, and without cleanup duplicate timers fire
// duplicate node_ready events for the same charge.
var _chargeReadyTimers = {};

function _clearChargeReady(path) {
  if (!path || !_chargeReadyTimers[path]) return;
  clearTimeout(_chargeReadyTimers[path]);
  delete _chargeReadyTimers[path];
}

function _clearAllChargeReady() {
  Object.keys(_chargeReadyTimers).forEach(function (p) {
    clearTimeout(_chargeReadyTimers[p]);
  });
  _chargeReadyTimers = {};
}

// One-shot per charge: at charge_end, run materialize() to transition the
// charging entry into nodes_collect and emit node_ready. Tests stub
// setTimeout via the override clock; we use the host setTimeout directly so
// production play actually fires.
function _scheduleChargeReady(chargeEnd, path) {
  if (typeof setTimeout !== 'function') return;
  _clearChargeReady(path);
  var msUntil = Math.max(0, chargeEnd - clockNow());
  var handle = setTimeout(function () {
    if (path) delete _chargeReadyTimers[path];
    var s = getState();
    if (!s) return;
    // Skip if the charge no longer exists (cancelled / already collected).
    if (path) {
      var stillCharging = (s.nodes_charging || []).some(function (c) { return c.path === path; });
      if (!stillCharging) return;
    }
    var mat = materialize(s, clockNow());
    setState(mat.state);
    var events = mat.events || [];
    for (var i = 0; i < events.length; i++) {
      _emit(events[i].ev, events[i].pl);
    }
  }, msUntil);
  if (path) _chargeReadyTimers[path] = handle;
}

// ---------------------------------------------------------------------------
// PRNG — Mulberry32, seeded for deterministic tests.
// Call setPrngSeed(n) before any handler invocation that uses RNG.
// ---------------------------------------------------------------------------
var _prngSeed = 0xDEADBEEF;

export function setPrngSeed(seed) {
  _prngSeed = seed >>> 0;
}

function _rng() {
  _prngSeed = (_prngSeed + 0x6D2B79F5) | 0;
  var t = Math.imul(_prngSeed ^ (_prngSeed >>> 15), 1 | _prngSeed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function _generateId() {
  // Timestamp base + two RNG words → collision-resistant string without deps.
  return Date.now().toString(36) +
    Math.floor(_rng() * 0xFFFFFF).toString(36) +
    Math.floor(_rng() * 0xFFFFFF).toString(36);
}

// Returns { gestalt, karma_delta } if a karma incident fires, else null.
// factor = sqrt((-karma)/100) + 0.05  (dd_app views.py:483 WeightedRandomizer)
function _handleKarmaIncident(gv, ruleset) {
  var karma = (gv && gv.karma_value) || 0;
  if (karma >= 0) return null;

  var factor = Math.pow((-karma) / 100, 0.5) + 0.05;
  if (_rng() >= factor) return null;

  var level = (gv && gv.xp_level) || 1;
  var eligible = (ruleset.karmalizers || []).filter(function (k) {
    return level >= ((k.type_data && k.type_data.required_level) || 1);
  });
  if (!eligible.length) return null;

  var k = eligible[Math.floor(_rng() * eligible.length)];
  return {
    gestalt:     (k.type_data && k.type_data.gestalt) || '',
    karma_delta: (k.type_data && k.type_data.karma_points) || -1
  };
}

// ---------------------------------------------------------------------------
// collectPerp — #17
// ---------------------------------------------------------------------------

/**
 * collectPerp(token, gperpPath) → Promise<{result}>
 *
 * Materialize first (moves ready charges → nodes_collect).  Branch on perp
 * game_type to build the typed result payload.  $pull from nodes_collect,
 * $inc xp_value (from ruleset type_data.xp_inc, NOT from the charge result).
 * Optionally fire karma incident.  For ContactPerp/ProjectPerp: $push
 * db_queue entry for integrateCollected.
 *
 * nodes_collect[i].result schema (written by chargePerp, Thread S PR #72):
 *   { amount: number } — varied collect_amount from _getVariatedAmount.
 *
 * Error codes match dd_app:
 *   1 — path not in nodes_collect (not ready / hasn't charged)
 *   2 — node not found in state.nodes
 *   3 — unknown game_type
 */
export function collectPerp(_token, gperpPath) {
  var state = getState();
  var now = clockNow();
  var ruleset = _getRuleset();

  // Materialise time-based progression before testing readiness.
  var mat = materialize(state, now);
  var ms = mat.state;

  var collectEntry = null;
  for (var i = 0; i < ms.nodes_collect.length; i++) {
    if (ms.nodes_collect[i].path === gperpPath) {
      collectEntry = ms.nodes_collect[i];
      break;
    }
  }
  if (!collectEntry) {
    // Materialized state is recoverable (materialize is pure), so an early
    // return doesn't persist it — the next handler call re-materialises.
    return Promise.resolve({ result: { error: 1 } });
  }

  var node = null;
  for (var j = 0; j < ms.nodes.length; j++) {
    if (ms.nodes[j].full_path === gperpPath) {
      node = ms.nodes[j];
      break;
    }
  }
  if (!node) {
    return Promise.resolve({ result: { error: 2 } });
  }

  var gestalt = node.gestalt || _gestaltFrom(node.full_type);
  var perpDef = gestalt && (ruleset.perps[gestalt] || ruleset.tokens[gestalt]);
  var typeData = perpDef && perpDef.type_data;

  var cr = collectEntry.result || {};
  var xpGain = (typeData && typeof typeData.xp_inc === 'number') ? typeData.xp_inc : 1;
  var gameType = node.game_type;

  var newCollect = ms.nodes_collect.filter(function (e) { return e.path !== gperpPath; });
  var newGv = Object.assign({}, ms.game_values, {
    xp_value: (ms.game_values.xp_value || 0) + xpGain
  });

  var innerResult;
  var newNodes = ms.nodes;
  var newQueue = ms.db_queue || [];
  var dbEntry = null;
  var tokenUpdate = null;

  if (gameType === 'ContactPerp' || gameType === 'ProjectPerp') {
    var collectId = _generateId();
    // ContactPerps store yielded token-types under `tokens`; TokenPerps
    // (super-token decomposition) under `contained_tokens` — accept either.
    var tokensMap = {};
    var contained = (typeData && (typeData.tokens || typeData.contained_tokens)) || [];
    for (var ct = 0; ct < contained.length; ct++) {
      var ctEntry = contained[ct];
      if (ctEntry && ctEntry.gestalt) {
        tokensMap[ctEntry.gestalt] = { amount: ctEntry.amount || 0 };
      }
    }
    var profileSet = { profiles_value: cr.amount || 0, tokens_map: tokensMap };
    dbEntry = {
      origin:      gperpPath,
      collect_id:  collectId,
      profile_set: profileSet,
      collect_dt:  now
    };
    newQueue = newQueue.concat([dbEntry]);
    innerResult = { profile_set: profileSet, origin: gperpPath, collect_id: collectId };

  } else if (gameType === 'ClientPerp') {
    var cashGain = cr.amount || 0;
    newGv = Object.assign({}, newGv, {
      cash_value: (ms.game_values.cash_value || 0) + cashGain
    });
    innerResult = { cash: newGv.cash_value };

  } else if (gameType === 'TokenPerp') {
    var prevAmount = (node.instance_data && node.instance_data.amount) || 0;
    var newAmount = prevAmount + (cr.amount || 0);
    tokenUpdate = { path: gperpPath, amount: newAmount };
    newNodes = ms.nodes.map(function (n) {
      if (n.full_path !== gperpPath) return n;
      return Object.assign({}, n, {
        instance_data: Object.assign({}, n.instance_data, { amount: newAmount })
      });
    });
    innerResult = { token_upgraded_amount: newAmount };

  } else {
    return Promise.resolve({ result: { error: 3 } });
  }

  var incident = _handleKarmaIncident(newGv, ruleset);
  if (incident) {
    newGv = Object.assign({}, newGv, {
      karma_value: Math.max(-100, Math.min(100,
        (newGv.karma_value || 0) + incident.karma_delta))
    });
  }

  var oldLevel = (ms.game_values && ms.game_values.xp_level) || 1;
  var newLevel = _getLevelByXP(newGv.xp_value);
  var levelup  = newLevel > oldLevel;
  if (levelup) {
    var collectLevels = _getRuleset().levels;
    var collectLevelInfo = collectLevels[newLevel - 1] || collectLevels[collectLevels.length - 1];
    newGv = Object.assign({}, newGv, {
      xp_level: newLevel,
      ap_snapshot: collectLevelInfo.ap_max
    });
  }

  var preMissionState = Object.assign({}, ms, {
    nodes:         newNodes,
    nodes_collect: newCollect,
    db_queue:      newQueue,
    game_values:   newGv,
    last_seen_ts:  Math.max(now, ms.last_seen_ts || 0)
  });

  var collectMissionResult;
  if (gameType === 'ContactPerp') {
    collectMissionResult = _advanceCollectProfilesMissions(preMissionState, gestalt, cr.amount || 0);
  } else if (gameType === 'ClientPerp') {
    collectMissionResult = _advanceCollectCashMissions(preMissionState, gestalt, cr.amount || 0);
  } else if (gameType === 'TokenPerp') {
    collectMissionResult = _advanceUpgradeTokenMissions(preMissionState, gestalt);
  } else {
    collectMissionResult = { missions: null, mission_goals: preMissionState.mission_goals,
      active_missions: preMissionState.active_missions };
  }
  newGv = _applyRewardsToGv(newGv, collectMissionResult.rewards);
  var newState = Object.assign({}, preMissionState, {
    game_values: newGv,
    mission_goals: collectMissionResult.mission_goals,
    active_missions: collectMissionResult.active_missions
  });

  var deltaResult = { game_values: newGv, path: gperpPath, missions: collectMissionResult.missions };
  if (dbEntry)     deltaResult.db_entry     = dbEntry;
  if (tokenUpdate) deltaResult.token_update = tokenUpdate;
  _persistDelta(_mkDelta(state.addr, 'collectPerp', [gperpPath], deltaResult));

  var response = Object.assign(
    { result: innerResult, game_values: newGv, levelup: levelup,
      missions: collectMissionResult.missions || { complete_missions: [], updated_missions: [] } },
    incident ? { karma_incident: incident.gestalt } : {}
  );

  // Emit materializer events + optional levelup new_items after the caller's
  // microtask resolves (mirrors dd_app's deferred Celery notifyLevelupItems).
  var matEvents = mat.events;
  var emitLevel = levelup ? newLevel : 0;
  queueMicrotask(function () {
    for (var ei = 0; ei < matEvents.length; ei++) {
      _emit(matEvents[ei].ev, matEvents[ei].pl);
    }
    if (emitLevel) {
      _emit('new_items', { perps: [], powerups: {}, trigger: 'levelup', level: emitLevel });
    }
  });

  return Promise.resolve({ result: response });
}

// ---------------------------------------------------------------------------
// integrateCollected — #17
// ---------------------------------------------------------------------------

/**
 * integrateCollected(token, collectId) → Promise<{result}>
 *
 * $pull the db_queue entry by collect_id.  Apply integration rewards:
 * $inc profiles_value (dup-safe), xp_value, karma_value.  Update token
 * node amounts from profile_set.tokens_map.  Persists a delta carrying
 * full game_values and the touched nodes so the reducer can replay it
 * on cold start.
 *
 * Error codes:
 *   0 — collect_id not in db_queue (already integrated or never collected)
 *   1 — insufficient AP (parity with chargePerp)
 */
export function integrateCollected(_token, collectId) {
  var rawState = getState();
  var now = clockNow();
  // Materialize so the AP regen ticks accumulated since the last call are
  // visible — same contract as collectPerp / chargePerp.
  var state = materialize(rawState, now).state;

  if ((state.game_values && state.game_values.ap_snapshot || 0) < 1) {
    return Promise.resolve({ result: { error: 1 } });
  }

  // $pull db_queue entry.
  var entry = null;
  var newQueue = (state.db_queue || []).filter(function (q) {
    if (q.collect_id === collectId) { entry = q; return false; }
    return true;
  });
  if (!entry) {
    return Promise.resolve({ result: { error: 0 } });
  }

  var ps = entry.profile_set || {};
  var profilesIncrement = ps.profiles_value || 0;

  var integratedIds = state.integrated_ids || {};
  var dup       = integratedIds[collectId] ? profilesIncrement : 0;
  var increment = integratedIds[collectId] ? 0 : profilesIncrement;
  var newIntegratedIds = Object.assign({}, integratedIds, { [collectId]: true });

  var xpGain    = ps.xp_gain    || 0;
  var karmaGain = ps.karma_gain || 0;
  var newGv = Object.assign({}, state.game_values, {
    xp_value:       (state.game_values.xp_value    || 0) + xpGain,
    karma_value: Math.max(-100, Math.min(100,
      (state.game_values.karma_value || 0) + karmaGain)),
    profiles_value: (state.game_values.profiles_value || 0) + increment,
    ap_snapshot:    Math.max(0, (state.game_values.ap_snapshot || 0) - 1)
  });

  var ruleset = _getRuleset();
  var tokensMap = ps.tokens_map || {};
  var updatedNodes = [];
  var seenGestalts = {};

  // Weighted-average share merge — upstream dd_app/dd_calc.py
  // `Database.merge` computes:
  //   new_share = min(100, (db_share * M + ps_share * N) / (M + N))
  // for every TokenPerp the new profileset touches, and dilutes
  // un-touched tokens by:
  //   new_share = (db_share * M) / (M + N)
  // `M` is `profiles_value` *before* this integration; `N` is the new
  // profileset's `profiles_value` (== `increment`, so 0 on a duplicate
  // collect_id replay → no share change). This preserves the absolute
  // count `profiles_value * share / 100`, so mission_goals' monotonic
  // current_amount keeps advancing. See docs/ui-meters.md.
  var M = (state.game_values && state.game_values.profiles_value) || 0;
  var N = increment;
  var denom = M + N;
  // denom === 0 only happens on a replay against an empty DB — every
  // share would round-trip to oldShare and no new tokens can be seeded
  // (seedShare = 0). Bail before the per-node arithmetic.
  var skipMerge = denom === 0;

  var newNodes = (state.nodes || []).map(function (n) {
    if (skipMerge) return n;
    if (n.game_type !== 'TokenPerp' || !n.gestalt) return n;
    var oldShare = (n.instance_data && n.instance_data.amount) || 0;
    var tok = tokensMap[n.gestalt];
    if (tok) seenGestalts[n.gestalt] = true;
    var psContrib = tok ? (tok.amount || 0) * N : 0;
    var newShare = Math.min(100, (oldShare * M + psContrib) / denom);
    if (newShare === oldShare) return n;
    var updated = Object.assign({}, n, {
      instance_data: Object.assign({}, n.instance_data, { amount: newShare })
    });
    updatedNodes.push({
      game_id:       updated.game_id,
      gestalt:       updated.gestalt,
      game_type:     updated.game_type,
      full_type:     updated.full_type,
      full_path:     updated.full_path,
      instance_data: updated.instance_data
    });
    return updated;
  });

  // First-time integration of a token type: append a new TokenPerp node
  // under Database.<gestalt>. Without this, DBTokens stays empty, the
  // Database tab stays blank, and integrate_profiles missions never tick.
  // Seed without x/y so the UI's setRandomPosition (Render.js:2393) places
  // the new tile with collision avoidance around (1024,800), then
  // saveCoordsQueue persists the resolved position. Pre-seeding x/y
  // bypassed that and made every new token stack at a single hashed point.
  // Initial share = ps_share * N / (M + N) (= ps_share when M = 0).
  if (!skipMerge) Object.keys(tokensMap).forEach(function (gestalt) {
    if (seenGestalts[gestalt]) return;
    if (!ruleset.tokens || !ruleset.tokens[gestalt]) return;
    var tok = tokensMap[gestalt];
    var seedShare = Math.min(100, ((tok.amount || 0) * N) / denom);
    var newNode = {
      game_id:    gestalt,
      gestalt:    gestalt,
      game_type:  'TokenPerp',
      full_type:  'TokenPerp:' + gestalt,
      full_path:  'Database.' + gestalt,
      instance_data: { amount: seedShare }
    };
    newNodes.push(newNode);
    updatedNodes.push({
      game_id:       newNode.game_id,
      gestalt:       newNode.gestalt,
      game_type:     newNode.game_type,
      full_type:     newNode.full_type,
      full_path:     newNode.full_path,
      instance_data: newNode.instance_data
    });
  });

  var oldLevel = (state.game_values && state.game_values.xp_level) || 1;
  var newLevel = _getLevelByXP(newGv.xp_value);
  var levelup  = newLevel > oldLevel;
  if (levelup) {
    var integrateLevels = _getRuleset().levels;
    var integrateLevelInfo = integrateLevels[newLevel - 1] || integrateLevels[integrateLevels.length - 1];
    newGv = Object.assign({}, newGv, {
      xp_level: newLevel,
      ap_snapshot: integrateLevelInfo.ap_max
    });
  }

  var preMissionState = Object.assign({}, state, {
    db_queue:       newQueue,
    nodes:          newNodes,
    game_values:    newGv,
    integrated_ids: newIntegratedIds,
    last_seen_ts:   Math.max(now, state.last_seen_ts || 0)
  });

  // Advance integrate_profiles goals against the new TokenPerp amounts.
  var missionResult = _advanceIntegrateProfilesMissions(
    preMissionState, newGv.profiles_value || 0, newNodes
  );
  newGv = _applyRewardsToGv(newGv, missionResult.rewards);
  var newState = Object.assign({}, preMissionState, {
    game_values: newGv,
    mission_goals: missionResult.mission_goals,
    active_missions: missionResult.active_missions
  });

  // Persist delta for webxdc replay; result carries full state for the reducer.
  _persistDelta(_mkDelta(state.addr, 'integrateCollected', [collectId],
    { increment: increment, dup: dup, game_values: newGv, nodes: updatedNodes,
      missions: missionResult.missions }));

  var response = {
    result: { nodes: updatedNodes, increment: increment, dup: dup },
    game_values: newGv,
    levelup: levelup,
    missions: missionResult.missions || { complete_missions: [], updated_missions: [] }
  };

  if (levelup) {
    queueMicrotask(function () {
      _emit('new_items', { perps: [], powerups: {}, trigger: 'levelup', level: newLevel });
    });
  }

  return Promise.resolve({ result: response });
}

// ---------------------------------------------------------------------------
// dismissMissionBriefing(token, gestalt) — record that the player has closed
// the briefing popup for a given mission so we don't re-open it on reload.
// ---------------------------------------------------------------------------

export function markTokenSeen(_token, gestalt) {
  if (typeof gestalt !== 'string' || !gestalt) {
    return Promise.resolve({ result: { error: 0 } });
  }
  var state = getState();
  var seen = state.tokens_seen || {};
  if (seen[gestalt]) {
    return Promise.resolve({ result: { ok: true } });
  }
  _persistDelta(_mkDelta(state.addr, 'markTokenSeen', [gestalt], { gestalt: gestalt }));
  return Promise.resolve({ result: { ok: true } });
}

export function dismissMissionBriefing(_token, gestalt) {
  if (typeof gestalt !== 'string' || !gestalt) {
    return Promise.resolve({ result: { error: 0 } });
  }
  var state = getState();
  var seen = state.mission_briefings_seen || {};
  if (seen[gestalt]) {
    return Promise.resolve({ result: { ok: true } });
  }
  _persistDelta(_mkDelta(state.addr, 'dismissMissionBriefing',
    [gestalt], { gestalt: gestalt }));
  return Promise.resolve({ result: { ok: true } });
}

// ---------------------------------------------------------------------------
// Stub handlers — Wave 4+ issues fill these in.
// ---------------------------------------------------------------------------
var _STUBS = [
  'checkUsername'
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
  getToken:           getToken,
  ping:               ping,
  getSessionLocale:   getSessionLocale,
  setLocale:          setLocale,
  loadGame:           loadGame,
  getRanking:         getRanking,
  setDisplayName:     setDisplayName,
  setPerpCoordinates: setPerpCoordinates,
  getProvidedPerps:   getProvidedPerps,
  getPowerups:        getPowerups,
  buyKarma:           buyKarma,
  buyPowerup:         buyPowerup,
  sellPowerup:        sellPowerup,
  buySlots:           buySlots,
  buyPerp:            buyPerp,
  chargePerp:         chargePerp,
  collectPerp:        collectPerp,
  integrateCollected: integrateCollected,
  dismissMissionBriefing: dismissMissionBriefing,
  markTokenSeen:      markTokenSeen,
  setEmitter:         setEmitter,
  setSendDelta:       setSendDelta,
  setPrngSeed:        setPrngSeed,
}, _stubHandlers);

export default LocalEngine;
