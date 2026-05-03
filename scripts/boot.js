// Boot sequence for the webxdc port of Data Dealer.
// Implements the four-step engine startup described in issue #10:
//
//   1. state = freshState(selfAddr) — selfAddr seeded BEFORE listener
//      registration so applyDelta's addr guards never see an empty state.addr
//      during boot replay (closes #117).
//   2. webxdc.setUpdateListener(cb, 0) — replays full update history.
//      The webxdc spec returns a Promise that resolves once every update
//      from `serial` up to the messenger's max_serial-at-registration has
//      been delivered to `cb`. boot() awaits that promise so the engine
//      is fully replayed before materializer / onReady fires; bootstrap.js
//      can then swap the loader for the game UI without flickering through
//      a partially-replayed state.
//      The callback is the SOLE setState site in production: it routes both
//      own-echoes (from sendUpdate) and remote peer deltas through the same
//      applyDelta path. Handlers in scripts/LocalEngine.js never call
//      setState directly (issue #120). In Node/tests, LocalEngine's
//      _persistDelta emulates this listener echo synchronously so the same
//      transition function (applyDelta) drives state in both environments.
//   3. After replay quiesces, call materializer (integration point for #11).
//   4. Engine ready; call options.onReady(state).
//
// This module intentionally has no test coverage of its own: it talks to the
// webxdc global and is exercised via manual testing or a webxdc simulator.
// The underlying state logic (freshState / applyDelta) is fully unit-tested in
// tests/state/state.test.js.

import { freshState, applyDelta } from './state.js';

var _currentState = null;
var _bootPromise  = null;

// Subscribers to state.peers reference-identity changes.  Fired by the
// listener whenever applyDelta produces a state whose .peers object differs
// (by reference) from the previous one — i.e. the peer aggregator added or
// updated an entry.  Used by the Topscores view to refresh the leaderboard
// without polling.  No event-bus dependency: this stays ESM-pure.
var _peersChangedSubs = [];

// Replay progress is updated on every listener callback during initial replay.
// Polled by bootstrap.js to drive the <progress id="loader"> element. The
// max_serial can grow if peers push new updates while we're catching up; the
// listener promise still resolves when the messenger's snapshot-at-
// registration max_serial is reached, so the bar may not visually fill — by
// design, since the game can start while later peer updates land live.
var _replayProgress = { serial: 0, max_serial: 0, done: false };

/**
 * boot(options) → Promise<LocalState>
 *
 * Idempotent: subsequent calls return the in-flight promise.
 *
 * options:
 *   selfAddr          — override webxdc.selfAddr (useful for simulator / tests)
 *   defaultGame       — override the default seed (object matching default_game.json shape)
 *   materializer      — function(state) called once after replay quiesces (#11 hook)
 *   onReady           — function(state) called when the engine is ready
 *   onReplayProgress  — function(serial, max_serial) called per replayed update
 */
export function boot(options) {
  if (_bootPromise) return _bootPromise;
  options = options || {};

  var selfAddr = options.selfAddr != null
    ? options.selfAddr
    : (typeof webxdc !== 'undefined' ? webxdc.selfAddr : '');  // eslint-disable-line no-undef

  // selfAddr MUST be set before the listener is registered.  applyDelta's
  // addr filter relies on state.addr to route between own-echoes and peer
  // deltas; an empty state.addr at boot would let pre-fix deltas mis-route.
  // The auto-seed in applyDelta (state.js, closes #117) is a belt; this is
  // the braces.
  _currentState = freshState(selfAddr, options.defaultGame);

  var listenerPromise = null;
  // eslint-disable-next-line no-undef
  if (typeof webxdc !== 'undefined') {
    // eslint-disable-next-line no-undef
    listenerPromise = webxdc.setUpdateListener(function (update) {
      var prevPeers = _currentState && _currentState.peers;
      _currentState = applyDelta(_currentState, update.payload);
      if (_currentState && _currentState.peers !== prevPeers) {
        _notifyPeersChanged();
      }
      var s = (typeof update.serial     === 'number') ? update.serial     : 0;
      var m = (typeof update.max_serial === 'number') ? update.max_serial : s;
      if (s > _replayProgress.serial)     _replayProgress.serial     = s;
      if (m > _replayProgress.max_serial) _replayProgress.max_serial = m;
      if (typeof options.onReplayProgress === 'function') {
        try { options.onReplayProgress(_replayProgress.serial, _replayProgress.max_serial); }
        catch (_) { /* never let the UI hook break replay */ }
      }
    }, 0);
  }

  // Promise.resolve handles three shapes uniformly:
  //   - real webxdc returns a Promise → awaited
  //   - dev shim (webxdc-shim.js) returns undefined → already resolved
  //   - typeof webxdc === 'undefined' (node) → already resolved
  _bootPromise = Promise.resolve(listenerPromise).then(function () {
    _replayProgress.done = true;
    if (typeof options.materializer === 'function') options.materializer(_currentState);
    if (typeof options.onReady === 'function') options.onReady(_currentState);
    return _currentState;
  });
  return _bootPromise;
}

/**
 * getBootPromise() → Promise<LocalState> | null
 * Returns the in-flight (or resolved) boot() promise, or null if boot()
 * has not been invoked yet. Bootstrap.js polls this to gate UI hand-off.
 */
export function getBootPromise() {
  return _bootPromise;
}

/**
 * getReplayProgress() → { serial, max_serial, done }
 * Snapshot of the current replay progress. `done` flips to true once the
 * setUpdateListener promise resolves and materializer / onReady have run.
 */
export function getReplayProgress() {
  return {
    serial:     _replayProgress.serial,
    max_serial: _replayProgress.max_serial,
    done:       _replayProgress.done
  };
}

/**
 * getState() → LocalState
 * Returns the current in-memory state after boot.  Always call boot() first.
 */
export function getState() {
  return _currentState;
}

/**
 * setState(newState) — replace the in-memory state.
 * Called by LocalEngine after materializer runs to persist the advanced state.
 * Also useful in tests to seed state before exercising handlers.
 *
 * Fires peers-changed subscribers when newState.peers differs by reference
 * from the previous state, so handler-driven echoes (chargePerp, buyKarma,
 * etc.) propagate to the Topscores view via the same channel as remote
 * peer deltas applied through the listener.
 */
export function setState(newState) {
  var prevPeers = _currentState && _currentState.peers;
  _currentState = newState;
  if (newState && newState.peers !== prevPeers) {
    _notifyPeersChanged();
  }
}

/**
 * subscribePeersChanged(fn) → unsubscribe()
 *
 * Registers fn(state) to be invoked whenever the in-memory state.peers
 * object identity changes.  Returns an unsubscribe function.  The legacy
 * Topscores view (scripts/Game.js) calls this from its event-handler init
 * to refresh the leaderboard when remote peer deltas land or own deltas
 * mutate the self peer entry.
 */
export function subscribePeersChanged(fn) {
  if (typeof fn !== 'function') return function noop() {};
  _peersChangedSubs.push(fn);
  return function unsubscribe() {
    var i = _peersChangedSubs.indexOf(fn);
    if (i >= 0) _peersChangedSubs.splice(i, 1);
  };
}

function _notifyPeersChanged() {
  for (var i = 0; i < _peersChangedSubs.length; i++) {
    try { _peersChangedSubs[i](_currentState); }
    catch (_) { /* never let one subscriber break the listener */ }
  }
}
