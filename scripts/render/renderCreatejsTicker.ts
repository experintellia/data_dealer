// Render-side wrapper around the CreateJS `Ticker` singleton.
//
// CreateJS-2015's `Ticker.addListener` / `Ticker.removeListener` are
// the legacy listener-array API; current TweenJS builds removed those
// methods in favour of `addEventListener('tick', fn)`.  Render code
// still wants the listener-array shape (`obj.tick()` is invoked once
// per frame), so this module installs an idempotent shim that bridges
// the legacy calls onto the modern EventDispatcher.
//
// The CreateJS `<script>` tag may not have parsed at module-load time,
// so we lazy-resolve `globalThis.createjs` on first use and cache it.
// Retires the `setRenderNodeTickers` injection seam that previously
// handed `Ticker.removeListener` to RenderNode from Render.ts.

interface CreateJSTickerLike {
  addListener?(target: object): void;
  removeListener?(target: object): void;
  addEventListener(event: 'tick', fn: () => void): void;
  removeEventListener(event: 'tick', fn: () => void): void;
  setFPS?(fps: number): void;
  framerate: number;
  useRAF: boolean;
}

interface CreateJSGlobal {
  Ticker: CreateJSTickerLike;
}

let _ticker: CreateJSTickerLike | undefined;

function resolveTicker(): CreateJSTickerLike {
  if (_ticker) return _ticker;
  const cj = (globalThis as { createjs?: CreateJSGlobal }).createjs;
  if (!cj) {
    throw new Error('renderCreatejsTicker: globalThis.createjs not loaded.');
  }
  const ticker = cj.Ticker;
  if (typeof ticker.addListener !== 'function') {
    const _tickHandlers = new WeakMap<object, () => void>();
    ticker.addListener = (obj: object): void => {
      if (_tickHandlers.has(obj)) {
        return;
      }
      const fn = (): void => {
        const tickable = obj as { tick?: () => void };
        if (typeof tickable.tick === 'function') {
          tickable.tick();
        }
      };
      _tickHandlers.set(obj, fn);
      ticker.addEventListener('tick', fn);
    };
    ticker.removeListener = (obj: object): void => {
      const fn = _tickHandlers.get(obj);
      if (fn) {
        ticker.removeEventListener('tick', fn);
        _tickHandlers.delete(obj);
      }
    };
  }
  // Always override setFPS so the modern `framerate=` setter is used
  // even when the legacy method still exists (it logs a deprecation
  // warning on every call in current TweenJS builds).
  ticker.setFPS = (fps: number): void => {
    ticker.framerate = fps;
  };
  _ticker = ticker;
  return ticker;
}

export function tickerAddListener(obj: object): void {
  resolveTicker().addListener?.(obj);
}

export function tickerRemoveListener(obj: object): void {
  resolveTicker().removeListener?.(obj);
}

export function tickerSetFPS(fps: number): void {
  resolveTicker().setFPS?.(fps);
}

export function tickerSetUseRAF(useRAF: boolean): void {
  resolveTicker().useRAF = useRAF;
}
