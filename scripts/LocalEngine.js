// Local replacement for the back-end JSON-RPC service.
// ESM exports — consumed by Remote.js via the AMD bridge in esm-bundle.js.
// No DOM globals in handler bodies; safe to import from Node for tests.
//
// Handlers implemented here: getToken, ping, getSessionLocale, loadGame (#12), resetGame (#20).
// Remaining handlers (#13–#21) are stubs that return a rejected Promise.

import { getState, setState } from './boot.js';
import { applyDelta } from './state.js';
import { materialize } from './materializer.js';
import { now as clockNow } from './clock.js';
import defaultRuleset from '../data/ruleset_3.de.json' with { type: 'json' };

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
  var ruleset = defaultRuleset;

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
// Stub handlers — Wave 4+ issues fill these in.
// ---------------------------------------------------------------------------
var _STUBS = [
  'buyPowerup', 'chargePerp', 'collectPerp', 'integrateCollected',
  'getPowerups', 'getProvidedPerps', 'buyKarma', 'buyPerp', 'buySlots',
  'setDisplayName', 'sellPowerup',
  'setPerpCoordinates', 'checkUsername'
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
  setEmitter: setEmitter
}, _stubHandlers);

export default LocalEngine;
