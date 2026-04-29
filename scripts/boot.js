// Boot sequence for the webxdc port of Data Dealer.
// Implements the four-step engine startup described in issue #10:
//
//   1. state = freshState()  from data/default_game.json
//   2. webxdc.setUpdateListener(cb, 0)  — replays full update history
//   3. After replay quiesces, call materializer (integration point for #11)
//   4. Engine ready; call options.onReady(state)
//
// This module intentionally has no test coverage of its own: it talks to the
// webxdc global and is exercised via manual testing or a webxdc simulator.
// The underlying state logic (freshState / applyDelta) is fully unit-tested in
// tests/state/state.test.js.

import { freshState, applyDelta } from './state.js';

var _currentState = null;

/**
 * boot(options)
 *
 * options:
 *   selfAddr     — override webxdc.selfAddr (useful for simulator / tests)
 *   defaultGame  — override the default seed (object matching default_game.json shape)
 *   materializer — function(state) called once after replay quiesces (#11 hook)
 *   onReady      — function(state) called when the engine is ready
 */
export function boot(options) {
  options = options || {};

  var selfAddr = options.selfAddr != null
    ? options.selfAddr
    : (typeof webxdc !== 'undefined' ? webxdc.selfAddr : '');  // eslint-disable-line no-undef

  _currentState = freshState(selfAddr, options.defaultGame);

  // Replay full update history from serial 0.  Delta Chat core delivers all
  // historical updates synchronously before returning, so the code below the
  // setUpdateListener call runs after replay is complete.
  webxdc.setUpdateListener(function (update) {  // eslint-disable-line no-undef
    _currentState = applyDelta(_currentState, update.payload);
  }, 0);

  // Integration point for issue #11 (Thread N — materializer).
  // The real materializer will advance time-based progress (charge timers,
  // AP regen, etc.) against the replayed state.  For now this is a noop.
  if (typeof options.materializer === 'function') {
    options.materializer(_currentState);
  }

  // Engine ready.
  if (typeof options.onReady === 'function') {
    options.onReady(_currentState);
  }
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
 */
export function setState(newState) {
  _currentState = newState;
}
