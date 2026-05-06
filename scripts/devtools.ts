// Browser-only devtools surface for the injectable clock.
//
// Loaded only when the page URL contains ?devtools=1.
// In production (no flag) this module is a no-op and `window.__dd` is never
// defined, so there is zero debug surface exposed to end users.
//
// Usage from a browser console or Playwright test:
//   window.__dd.setNow(Date.now() + 86_400_000);  // jump 1 day forward
//   window.__dd.advanceNow(3_600_000);             // advance by 1 hour
//   window.__dd.clearNowOverride();                // revert to real wall clock
//   window.__dd.getZoom();                          // current zoom of active ViewMap
//   window.__dd.setZoom(0.6);                       // jump zoom (no animation)
//
// File converted from devtools.js in PR 27 of issue #147; `@ts-nocheck`
// quarantine dropped.

import { advance, clearOverride, setOverride } from './clock.js';

interface ZyngaScrollerLike {
  __zoomLevel?: number;
  zoomTo?(level: number, animate?: boolean): void;
}

interface ViewMapRenderNodeLike {
  scroller?: ZyngaScrollerLike;
}

interface ViewLike {
  renderNode?: ViewMapRenderNodeLike;
}

interface GameLike {
  activeView?: ViewLike;
  getImperium?(): ViewLike | undefined;
}

interface DevToolsHooks {
  setNow: typeof setOverride;
  advanceNow: typeof advance;
  clearNowOverride: typeof clearOverride;
  getZoom(): number | null;
  setZoom(level: number): void;
  /** Set by `app.ts` once `Application.start()` finishes — exposes the
   *  GameRoot instance to the dev-time hooks. */
  _app?: { game?: GameLike };
}

declare global {
  interface Window {
    __dd?: DevToolsHooks;
  }
}

if (
  typeof window !== 'undefined' &&
  typeof window.location !== 'undefined' &&
  new URLSearchParams(window.location.search).get('devtools') === '1'
) {
  // app.js populates window.__dd._app once Application.start finishes, so
  // the active ViewMap may not be reachable until after the boot sequence.
  const activeViewMap = (): ViewMapRenderNodeLike | null => {
    const game = window.__dd?._app?.game;
    if (!game) return null;
    const view = game.activeView ?? game.getImperium?.();
    return view?.renderNode ?? null;
  };

  window.__dd = {
    setNow: setOverride,
    advanceNow: advance,
    clearNowOverride: clearOverride,
    // Test hooks for the zoom-controls e2e spec — read from / write to the
    // active ViewMap's scroller without exposing the whole app surface.
    getZoom: (): number | null => {
      const vm = activeViewMap();
      return vm?.scroller?.__zoomLevel ?? null;
    },
    setZoom: (level: number): void => {
      const vm = activeViewMap();
      if (vm?.scroller?.zoomTo) vm.scroller.zoomTo(level, false);
    },
  };
}
