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
//      is fully replayed before materializer / onReady fires; bootstrap.ts
//      can then swap the loader for the game UI without flickering through
//      a partially-replayed state.
//      The callback is the SOLE setState site in production: it routes both
//      own-echoes (from sendUpdate) and remote peer deltas through the same
//      applyDelta path. Handlers in scripts/LocalEngine.ts never call
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

import { applyDelta, freshState } from './state.js';
import type { GameSeed, LocalState } from './state.js';
import { probeAvatarSupport } from './webxdc-avatars.js';

export interface BootOptions {
  /** Override webxdc.selfAddr (useful for simulator / tests). */
  selfAddr?: string;
  /** Override the default seed (object matching default_game.json shape). */
  defaultGame?: GameSeed;
  /** Called once after replay quiesces (#11 hook). */
  materializer?: (state: LocalState) => void;
  /** Called when the engine is ready. */
  onReady?: (state: LocalState) => void;
  /** Called per replayed update. */
  onReplayProgress?: (serial: number, maxSerial: number) => void;
}

interface ReplayProgress {
  serial: number;
  max_serial: number;
  done: boolean;
}

type PeersChangedSubscriber = (state: LocalState) => void;

let _currentState: LocalState | null = null;
let _bootPromise: Promise<LocalState> | null = null;

// Subscribers notified whenever applyDelta produces a new state.peers
// reference.  Used by the Topscores view to refresh the leaderboard
// without polling.  ESM-pure (no jQuery/event-bus dependency).
const _peersChangedSubs: PeersChangedSubscriber[] = [];

// Replay progress is updated on every listener callback during initial replay.
// Polled by bootstrap.ts to drive the <progress id="loader"> element. The
// max_serial can grow if peers push new updates while we're catching up; the
// listener promise still resolves when the messenger's snapshot-at-
// registration max_serial is reached, so the bar may not visually fill — by
// design, since the game can start while later peer updates land live.
const _replayProgress: ReplayProgress = { serial: 0, max_serial: 0, done: false };

/**
 * boot(options) → Promise<LocalState>
 *
 * Idempotent: subsequent calls return the in-flight promise.
 */
export function boot(options?: BootOptions): Promise<LocalState> {
  if (_bootPromise) return _bootPromise;
  const opts: BootOptions = options || {};

  const selfAddr =
    opts.selfAddr != null
      ? opts.selfAddr
      : typeof webxdc !== 'undefined' && webxdc
        ? webxdc.selfAddr
        : '';

  // selfAddr MUST be set before the listener is registered.  applyDelta's
  // addr guard rejects any delta whose addr differs from state.addr, including
  // when state.addr is empty (closes #130); seeding it here ensures replayed
  // own-echoes are never dropped.
  _currentState = freshState(selfAddr, opts.defaultGame);

  let listenerPromise: Promise<void> | null = null;
  if (typeof webxdc !== 'undefined' && webxdc) {
    listenerPromise = webxdc.setUpdateListener(function (update) {
      const prevPeers = _currentState && _currentState.peers;
      _currentState = applyDelta(_state(), update.payload);
      if (_currentState && _currentState.peers !== prevPeers) {
        _notifyPeersChanged();
      }
      const s = typeof update.serial === 'number' ? update.serial : 0;
      const m = typeof update.max_serial === 'number' ? update.max_serial : s;
      if (s > _replayProgress.serial) _replayProgress.serial = s;
      if (m > _replayProgress.max_serial) _replayProgress.max_serial = m;
      if (typeof opts.onReplayProgress === 'function') {
        try {
          opts.onReplayProgress(_replayProgress.serial, _replayProgress.max_serial);
        } catch (_) {
          /* never let the UI hook break replay */
        }
      }
    }, 0);
  }

  // Fire-and-forget probe of the experimental webxdc avatar API
  // (chatmail/core#6429). Gating on the resolved support flag means
  // the leaderboard either always renders the avatar slot or never
  // does — no late layout shift when the first <img> 404s.
  probeAvatarSupport(selfAddr);

  // Promise.resolve handles three shapes uniformly:
  //   - real webxdc returns a Promise → awaited
  //   - dev shim (webxdc-shim.ts) returns undefined → already resolved
  //   - typeof webxdc === 'undefined' (node) → already resolved
  _bootPromise = Promise.resolve(listenerPromise).then(function () {
    _replayProgress.done = true;
    const state = _state();
    if (typeof opts.materializer === 'function') opts.materializer(state);
    if (typeof opts.onReady === 'function') opts.onReady(state);
    return state;
  });
  return _bootPromise;
}

// Single runtime narrow over the `_currentState: LocalState | null` slot.
// Every public reader funnels through here so the per-call-site `as LocalState`
// casts collapse into one assertion.  Throws if called before boot() seeds the
// slot — never happens in production (boot is the first thing index.html runs)
// but the throw makes the misuse surface immediately in tests.
function _state(): LocalState {
  if (!_currentState) throw new Error('boot.ts: getState/_state called before boot()');
  return _currentState;
}

/**
 * getBootPromise() → Promise<LocalState> | null
 * Returns the in-flight (or resolved) boot() promise, or null if boot()
 * has not been invoked yet. bootstrap.ts polls this to gate UI hand-off.
 */
export function getBootPromise(): Promise<LocalState> | null {
  return _bootPromise;
}

/**
 * Snapshot of the current replay progress. `done` flips to true once the
 * setUpdateListener promise resolves and materializer / onReady have run.
 */
export function getReplayProgress(): ReplayProgress {
  return {
    serial: _replayProgress.serial,
    max_serial: _replayProgress.max_serial,
    done: _replayProgress.done,
  };
}

/** Returns the current in-memory state after boot.  Always call boot() first. */
export function getState(): LocalState {
  return _state();
}

/**
 * Test-only: clear the boot singletons so the next boot() re-runs and
 * re-registers the setUpdateListener against a fresh messenger. boot() is
 * idempotent in production (one boot per page load) but unit tests boot once
 * per test against a new fake-webxdc; without this reset the cached
 * _bootPromise would skip listener registration on the new messenger.
 */
export function __resetBootForTest(): void {
  _bootPromise = null;
  _currentState = null;
  _replayProgress.serial = 0;
  _replayProgress.max_serial = 0;
  _replayProgress.done = false;
  _peersChangedSubs.length = 0;
}

/**
 * Replace the in-memory state.  Called by LocalEngine after materializer
 * runs to persist the advanced state.  Also useful in tests to seed state
 * before exercising handlers.
 *
 * Fires peers-changed subscribers when newState.peers differs by reference
 * from the previous state, so handler-driven echoes (chargePerp, buyKarma,
 * etc.) propagate to the Topscores view via the same channel as remote
 * peer deltas applied through the listener.
 */
export function setState(newState: LocalState): void {
  const prevPeers = _currentState && _currentState.peers;
  _currentState = newState;
  if (newState && newState.peers !== prevPeers) {
    _notifyPeersChanged();
  }
}

/**
 * Registers fn(state) to be invoked when state.peers reference changes.
 * Returns an unsubscribe function.  The legacy Topscores view
 * (scripts/Game.js) calls this to refresh the leaderboard when remote
 * peer deltas land or own deltas mutate the self peer entry.
 */
export function subscribePeersChanged(fn: PeersChangedSubscriber): () => void {
  if (typeof fn !== 'function') return function noop() {};
  _peersChangedSubs.push(fn);
  return function unsubscribe() {
    const i = _peersChangedSubs.indexOf(fn);
    if (i >= 0) _peersChangedSubs.splice(i, 1);
  };
}

function _notifyPeersChanged(): void {
  if (!_currentState) return;
  for (let i = 0; i < _peersChangedSubs.length; i++) {
    const sub = _peersChangedSubs[i];
    if (!sub) continue;
    try {
      sub(_currentState);
    } catch (_) {
      /* never let one subscriber break the listener */
    }
  }
}
