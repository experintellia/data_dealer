// Injectable clock for the webxdc port of Data Dealer.
//
// clock.now() is the single authoritative time source for all game logic.
// Tests advance time in O(1) via setOverride / advance; production never sets
// an override so window.__dd is never defined (see scripts/devtools.js).
//
// Clock-skew guard: state.js still applies Math.max(clockNow(), last_seen_ts)
// so that a skewed system clock or a stale override never rewinds stored
// progress.  That guard lives in applyDelta, not here, to keep this module
// free of state imports.
//
// No DOM globals — safe to import from Node test environments.

var _override = null;

/**
 * Returns the current time in epoch-ms.
 *
 * If an override is set (via setOverride or advance), that value is returned
 * until clearOverride() is called; otherwise returns Date.now().
 */
export function now() {
  return _override !== null ? _override : Date.now();
}

/**
 * Pin the clock to a fixed epoch-ms value.  All subsequent calls to now()
 * return this value until clearOverride() is called.
 *
 * Useful in tests to jump forward by hours or days in O(1).
 */
export function setOverride(t) {
  _override = t;
}

/** Remove the override; now() reverts to Date.now(). */
export function clearOverride() {
  _override = null;
}

/**
 * Advance the clock by deltaMs milliseconds relative to the current now().
 *
 * Equivalent to setOverride(now() + deltaMs).  If no override is currently
 * active, the base is the real Date.now() at the moment advance() is called.
 */
export function advance(deltaMs) {
  _override = now() + deltaMs;
}
