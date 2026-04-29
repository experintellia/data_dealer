// Local replacement for the back-end JSON-RPC service.
// ESM exports — consumed by Remote.js via the AMD bridge in esm-bundle.js.
// No DOM globals in handler bodies; safe to import from Node for tests.
//
// Handlers implemented here: getToken, ping, getSessionLocale, loadGame (#12),
// resetGame (#20), getRanking, setDisplayName, setPerpCoordinates (#13),
//   getProvidedPerps, getPowerups (#14), buyKarma (#19),
//   buyPowerup, sellPowerup, buySlots (#18).
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

// webxdc.sendUpdate triggers setUpdateListener → applyDelta in boot.js, so we
// must NOT also call setState — that would double-apply the change.
// In Node/test environments there is no listener, so setState directly.
function _persistDelta(computedNewState, addr, op, args, result) {
  var delta = {
    kind: 'delta',
    addr: addr,
    op: op,
    args: args,
    result: result,
    ts: clockNow()
  };
  // eslint-disable-next-line no-undef
  if (typeof webxdc !== 'undefined') {
    webxdc.sendUpdate({ payload: delta }, '');  // eslint-disable-line no-undef
  } else {
    setState(computedNewState);
  }
}

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
  for (var i = 0; i < powerups.length; i++) {
    if (powerups[i].slot === slot) return Promise.resolve({ result: { error: 1 } });
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

  var newState = Object.assign({}, state, { nodes: newNodes, game_values: newGameValues });

  var responseNode = {
    game_id: node.game_id, game_type: node.game_type,
    full_path: node.full_path, instance_data: newInstanceData
  };
  var result = { node: responseNode, game_values: newGameValues, levelup: levelup };

  _persistDelta(newState, state.addr, 'buyPowerup',
    [token, perpPath, slot, gestalt], result);

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

  var newState = Object.assign({}, state, { nodes: newNodes, game_values: newGameValues });

  var responseNode = {
    game_id: node.game_id, game_type: node.game_type,
    full_path: node.full_path, instance_data: newInstanceData
  };
  var result = { node: responseNode, game_values: newGameValues, levelup: levelup };

  _persistDelta(newState, state.addr, 'sellPowerup',
    [token, perpPath, slot, gestalt], result);

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

  var newState = Object.assign({}, state, { nodes: newNodes, game_values: newGameValues });

  var responseNode = {
    game_id: node.game_id, game_type: node.game_type,
    full_path: node.full_path, instance_data: newInstanceData
  };
  var result = { node: responseNode, game_values: newGameValues, levelup: levelup };

  _persistDelta(newState, state.addr, 'buySlots',
    [token, perpPath, slotType, num], result);

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

  // ── 1. Look up perp definition ──────────────────────────────────────────
  var allTypes = Object.assign({}, ruleset.perps, ruleset.tokens);
  var perpDef = allTypes[gestalt];
  if (!perpDef) {
    return Promise.resolve({ result: { error: 1 } });
  }
  var typeData = perpDef.type_data || {};
  var gameType = perpDef.game_type;

  // ── 2. Level requirement ────────────────────────────────────────────────
  var gv = state.game_values || {};
  var currentLevel = gv.xp_level || 1;
  var requiredLevel = typeData.required_level != null ? typeData.required_level : 1;
  if (currentLevel < requiredLevel) {
    return Promise.resolve({ result: { error: 1 } });
  }

  // ── 3. Parent resolution ────────────────────────────────────────────────
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

  // ── 4. provided_perps slot list ─────────────────────────────────────────
  // Only validate when we can resolve the parent's type definition.
  var parentGestalt = parentNode ? (parentNode.gestalt || '') : '';
  var parentTypeDef = parentGestalt ? allTypes[parentGestalt] : null;
  var parentTypeData = parentTypeDef ? (parentTypeDef.type_data || {}) : null;

  if (parentTypeData && Array.isArray(parentTypeData.provided_perps)) {
    if (parentTypeData.provided_perps.indexOf(gestalt) === -1) {
      return Promise.resolve({ result: { error: 1 } });
    }
  }

  // ── 5. ProxyPerp max_slots check (error 3) ─────────────────────────────
  if (parentNode && parentNode.game_type === 'ProxyPerp') {
    var maxSlots = (parentTypeData && parentTypeData.max_slots) || 0;
    var childPrefix = parentPath + '.';
    var childCount = 0;
    var allNodes = state.nodes || [];
    for (var ci = 0; ci < allNodes.length; ci++) {
      if (allNodes[ci].full_path.indexOf(childPrefix) === 0) { childCount++; }
    }
    if (childCount >= maxSlots) {
      return Promise.resolve({ result: { error: 3 } });
    }
  }

  // ── 6. Cash check (error 2) ─────────────────────────────────────────────
  var price = typeof typeData.price === 'number' ? typeData.price : 0;
  if (gv.cash_value < price) {
    return Promise.resolve({ result: { error: 2 } });
  }

  // ── 7. Duplicate check (error 4) ────────────────────────────────────────
  var newFullPath = parentPath + '.' + gestalt;
  var stateNodes = state.nodes || [];
  for (var di = 0; di < stateNodes.length; di++) {
    if (stateNodes[di].full_path === newFullPath) {
      return Promise.resolve({ result: { error: 4 } });
    }
  }

  // ── 8. Generate game_id (monotonic counter, deterministic for tests) ────
  var nodeCounter = (state.node_counter || 0) + 1;
  var gameId = 'node_' + nodeCounter;

  // ── 9. Build new node ───────────────────────────────────────────────────
  var newNode = {
    game_id: gameId,
    game_type: gameType,
    full_type: gameType + ':' + gestalt,
    gestalt: gestalt,
    full_path: newFullPath,
    instance_data: {}
  };

  // ── 10. Economy mutations ───────────────────────────────────────────────
  var xpInc = typeof typeData.xp_inc === 'number' ? typeData.xp_inc : 0;
  var profilesMaxInc = typeof typeData.profiles_max === 'number' ? typeData.profiles_max : 0;

  var newGv = Object.assign({}, gv, {
    cash_value: gv.cash_value - price,
    cash_spent: (gv.cash_spent || 0) + price,
    xp_value: (gv.xp_value || 0) + xpInc,
    profiles_max: (gv.profiles_max || 0) + profilesMaxInc
  });

  // ── 11. Level-up check ──────────────────────────────────────────────────
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
        ap_max: levelInfo.ap_max
      });
    }
  }

  // ── 12. Mission progress (buy_perp workflow goals) ──────────────────────
  var missionResult = _advanceBuyPerpMissions(state, gestalt);

  // ── 13. profile_set for project*/contact*/city* gestalts ────────────────
  // db_queue entry + response field, per issue #15 / response-shapes.md §buyPerp
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
    profileSetPayload = {
      profile_set: generatedProfileSet,
      origin: newFullPath,
      collect_id: collectId
    };
    newDbQueue = newDbQueue.concat([{
      origin: newFullPath,
      collect_id: collectId,
      profile_set: generatedProfileSet
    }]);
  }

  // ── 14. Persist new state ───────────────────────────────────────────────
  var updatedNodes = (state.nodes || []).concat([newNode]);
  var finalMissionGoals = missionResult.mission_goals || state.mission_goals;
  var finalActiveMissions = missionResult.active_missions || state.active_missions;

  var missionPayload = missionResult.missions || null;

  var newState = Object.assign({}, state, {
    nodes: updatedNodes,
    db_queue: newDbQueue,
    game_values: newGv,
    mission_goals: finalMissionGoals,
    active_missions: finalActiveMissions,
    node_counter: nodeCounter
  });
  setState(newState);

  // ── 15. Emit delta (replayed by state.js buyPerp reducer on cold start) ─
  var now = clockNow();
  var deltaResult = {
    node: newNode,
    game_values: newGv,
    levelup: levelup,
    missions: missionPayload
  };
  if (profileSetPayload) { deltaResult.profile_set = profileSetPayload; }

  var delta = {
    kind: 'delta',
    addr: state.addr,
    op: 'buyPerp',
    args: [parentPath, gestalt],
    result: deltaResult,
    ts: now
  };

  // eslint-disable-next-line no-undef
  if (typeof webxdc !== 'undefined') { webxdc.sendUpdate({ payload: delta }, ''); }

  // ── 16. Return response ─────────────────────────────────────────────────
  var response = {
    node: newNode,
    game_values: newGv,
    levelup: levelup,
    missions: missionPayload
  };
  if (profileSetPayload) { response.profile_set = profileSetPayload; }

  return Promise.resolve({ result: response });
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
      return Object.assign({}, goal, { complete: true, current_amount: goal.amount || 1 });
    }
    return goal;
  });

  if (!changed) {
    return { missions: null, mission_goals: missionGoals, active_missions: activeMissions };
  }

  var updatedMissionIds = [];
  var completedMissionIds = [];
  activeMissions.forEach(function (mGestalt) {
    var goals = updatedGoals.filter(function (g) { return g.mission === mGestalt; });
    if (!goals.length) { return; }
    updatedMissionIds.push(mGestalt);
    if (goals.every(function (g) { return g.complete; })) {
      completedMissionIds.push(mGestalt);
    }
  });

  var newActiveMissions = activeMissions.filter(function (m) {
    return completedMissionIds.indexOf(m) === -1;
  });

  return {
    missions: {
      complete_missions: completedMissionIds,
      updated_missions: updatedMissionIds,
      mission_data: {
        active_missions: newActiveMissions,
        mission_goals: updatedGoals
      }
    },
    mission_goals: updatedGoals,
    active_missions: newActiveMissions
  };
}

// ---------------------------------------------------------------------------
// Stub handlers — Wave 4+ issues fill these in.
// ---------------------------------------------------------------------------
var _STUBS = [
  'chargePerp', 'collectPerp', 'integrateCollected', 'checkUsername'
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
  getToken:          getToken,
  ping:              ping,
  getSessionLocale:  getSessionLocale,
  loadGame:          loadGame,
  getRanking:        getRanking,
  resetGame:         resetGame,
  setDisplayName:    setDisplayName,
  setPerpCoordinates: setPerpCoordinates,
  getProvidedPerps:  getProvidedPerps,
  getPowerups:       getPowerups,
  buyKarma:          buyKarma,
  buyPowerup:        buyPowerup,
  sellPowerup:       sellPowerup,
  buySlots:          buySlots,
  buyPerp:           buyPerp,
  setEmitter:        setEmitter
}, _stubHandlers);

export default LocalEngine;
