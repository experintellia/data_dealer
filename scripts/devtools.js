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

import { setOverride, clearOverride, advance } from './clock.js';

if (
  typeof window !== 'undefined' &&
  typeof window.location !== 'undefined' &&
  new URLSearchParams(window.location.search).get('devtools') === '1'
) {
  window.__dd = {
    setNow:          setOverride,
    advanceNow:      advance,
    clearNowOverride: clearOverride,
  };
}
