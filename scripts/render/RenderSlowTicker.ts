// Render-side `SlowTicker` — the slow-cadence (120ms) tick driver
// that DecoratorTimer registers itself with for the per-second
// countdown sweep.  Written as a singleton, like the original
// CreateJS Ticker, but with its own setTimeout loop instead of
// hooking into the Easel render loop. RenderDecorators imports
// this singleton directly now.
//
// Auto-starts on first import.  Module-load timing is fine: the
// loop body just walks the (initially empty) `listeners` set, and
// each tick costs one `setTimeout` call until a listener is added.

import { OrderedSet } from '../game/OrderedSet.js';

interface TickerListener {
  tick(): void;
}

const _frameRate = 120;
// `OrderedSet` rather than `RenderSet` — we only need `each` /
// `add` / `remove`, none of the RenderSet bulk-action methods,
// and `TickerListener`'s only-`tick()` shape doesn't satisfy the
// `RenderNodeLike` constraint anyway.
const _listeners = new OrderedSet<TickerListener>();
let _timeout: number | undefined;

function tick(): void {
  _timeout = undefined;
  // Skip work and the reschedule when there's nothing to tick (no
  // listeners) or the tab is hidden. `addListener` and the
  // visibilitychange handler below resume the loop when work shows up.
  const hidden = typeof document !== 'undefined' && document.hidden;
  if (hidden || _listeners.set.length === 0) {
    return;
  }
  _listeners.each((node) => {
    node.tick();
  });
  if (typeof window !== 'undefined') {
    _timeout = window.setTimeout(tick, _frameRate);
  }
}

function start(): void {
  if (_timeout === undefined && typeof window !== 'undefined') {
    tick();
  }
}

function stop(): void {
  if (_timeout !== undefined) {
    window.clearTimeout(_timeout);
    _timeout = undefined;
  }
}

function addListener(node: TickerListener): void {
  _listeners.add(node);
  // Resume ticking if we were idle (listeners had been empty or tab
  // hidden when the previous tick early-returned).
  if (_timeout === undefined) {
    start();
  }
}

function removeListener(node: TickerListener): void {
  _listeners.remove(node);
}

// Resume ticking when the tab becomes visible again. start()'s own
// guard plus the addListener guard above make this idempotent.
if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && _timeout === undefined) start();
  });
}

// Keep the public surface identical to the legacy IIFE-local
// singleton (`{ start, tick, addListener, removeListener, stop,
// listeners }`) so the Render publisher's `SlowTicker:` entry and
// any external consumer keeps working unchanged.
export const RenderSlowTicker = {
  start,
  tick,
  addListener,
  removeListener,
  stop,
  listeners: _listeners,
};

// Auto-start when imported into a real DOM environment.  The
// `typeof window !== 'undefined'` guard keeps Node-side toolchain
// tests (which import the ESM bundle without a DOM) from booting
// the recursive setTimeout loop.
start();
