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

// Subscribers to user-visible peer changes (display_name, cash, profiles,
// xp, level, spent).  Used by the Topscores view to refresh without polling.
// Per-delta book-keeping fields like last_seen_ts are deliberately excluded
// so handlers that touch only the timestamp (setLocale, markTokenSeen, etc.)
// don't trigger a leaderboard re-fetch.
var _peersChangedSubs = [];

var _LEADERBOARD_FIELDS = ['display_name', 'cash', 'profiles', 'xp', 'level', 'spent'];

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
      _maybeNotifyPeersChanged(prevPeers, _currentState && _currentState.peers);
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
 * Fires peers-changed subscribers when a user-visible peer field changed,
 * so handler-driven echoes (chargePerp, buyKarma, etc.) propagate to the
 * Topscores view via the same channel as remote peer deltas applied through
 * the listener.
 */
export function setState(newState) {
  var prevPeers = _currentState && _currentState.peers;
  _currentState = newState;
  _maybeNotifyPeersChanged(prevPeers, newState && newState.peers);
}

/**
 * subscribePeersChanged(fn) → unsubscribe()
 *
 * Registers fn(state) to be invoked when a user-visible peer field changes
 * (display_name / cash / profiles / xp / level / spent).  Returns an
 * unsubscribe function.  Used by the legacy Topscores view (scripts/Game.js)
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

// Fires _peersChangedSubs only when at least one peer's leaderboard fields
// differ between prev and next.  Cheap object-identity short-circuits handle
// the common no-op case (same .peers reference); the field walk runs only
// when applyDelta produced a fresh peers object.
function _maybeNotifyPeersChanged(prevPeers, nextPeers) {
  if (prevPeers === nextPeers) return;
  if (!_peersValueChanged(prevPeers, nextPeers)) return;
  for (var i = 0; i < _peersChangedSubs.length; i++) {
    try { _peersChangedSubs[i](_currentState); }
    catch (_) { /* never let one subscriber break the listener */ }
  }
}

function _peersValueChanged(prev, next) {
  var prevPeers = prev || {};
  var nextPeers = next || {};
  var nextKeys = Object.keys(nextPeers);
  if (nextKeys.length !== Object.keys(prevPeers).length) return true;
  for (var i = 0; i < nextKeys.length; i++) {
    var k = nextKeys[i];
    var p = prevPeers[k];
    var n = nextPeers[k];
    if (!p || !n) return true;
    if (p === n) continue;
    for (var f = 0; f < _LEADERBOARD_FIELDS.length; f++) {
      var key = _LEADERBOARD_FIELDS[f];
      if (p[key] !== n[key]) return true;
    }
  }
  return false;
}
