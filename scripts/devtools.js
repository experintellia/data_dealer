// @ts-nocheck — strict-TS quarantine; remove when this file is migrated to TS (issue #147)
// Browser-only devtools surface for the injectable clock.
//
// Loaded only when the page URL contains ?devtools=1.
// In production (no flag) this module is a no-op and window.__dd is never
// defined, so there is zero debug surface exposed to end users.
//
// Usage from a browser console or Playwright test:
//   window.__dd.setNow(Date.now() + 86_400_000);  // jump 1 day forward
//   window.__dd.advanceNow(3_600_000);             // advance by 1 hour
//   window.__dd.clearNowOverride();                // revert to real wall clock
//   window.__dd.getZoom();                          // current zoom of active ViewMap
//   window.__dd.setZoom(0.6);                       // jump zoom (no animation)

import { advance, clearOverride, setOverride } from './clock.js';

if (
  typeof window !== 'undefined' &&
  typeof window.location !== 'undefined' &&
  new URLSearchParams(window.location.search).get('devtools') === '1'
) {
  // app.js populates window.__dd._app once Application.start finishes, so
  // the active ViewMap may not be reachable until after the boot sequence.
  const activeViewMap = () => {
    const game = window.__dd._app && window.__dd._app.game;
    if (!game) return null;
    const view = game.activeView || (game.getImperium && game.getImperium());
    return (view && view.renderNode) || null;
  };
  window.__dd = {
    setNow: setOverride,
    advanceNow: advance,
    clearNowOverride: clearOverride,
    // Test hooks for the zoom-controls e2e spec — read from / write to the
    // active ViewMap's scroller without exposing the whole app surface.
    getZoom: () => {
      const vm = activeViewMap();
      return vm && vm.scroller ? vm.scroller.__zoomLevel : null;
    },
    setZoom: (level) => {
      const vm = activeViewMap();
      if (vm && vm.scroller && typeof vm.scroller.zoomTo === 'function') {
        vm.scroller.zoomTo(level, false);
      }
    },
  };
}
