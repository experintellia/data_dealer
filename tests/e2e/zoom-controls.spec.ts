/**
 * Zoom-controls test — verifies the Fullscreen / center button in
 * .ZoomControls resets the active ViewMap's zoom level back to 1.0
 * regardless of the starting zoom.
 *
 * Regression context: the button used to call scroller.zoomTo(1, true)
 * followed by a debounced scrollTo, which interrupted the zoom tween
 * mid-flight and left zoom stuck at the partial value.  The fix combines
 * both into a single scroller.scrollTo(left, top, true, 1) call so the
 * scroller publishes one tween, not two.  This test pins that behavior.
 */

import { test, expect } from '@playwright/test';

interface DDHook {
  __dd?: {
    getZoom?: () => number | null;
    setZoom?: (level: number) => void;
  };
}

test('zoom-controls: Fullscreen button resets zoom to 1.0 from any zoom level', async ({
  page,
}) => {
  await page.goto('/?devtools=1');
  await expect(page.locator('[data-testid="game-container"]')).toBeVisible({
    timeout: 50_000,
  });

  // Dismiss the first-launch locale picker if it appears — it's an
  // overlay that intercepts clicks on the ZoomControls below it.  Picking
  // EN persists the locale and reloads the page; subsequent waits handle
  // the re-bootstrap.
  const picker = page.locator('.LangSelectOverlay');
  if (await picker.isVisible().catch(() => false)) {
    await picker.locator('.lang-pick[data-locale="en"]').click();
    await expect(page.locator('[data-testid="game-container"]')).toBeVisible({
      timeout: 50_000,
    });
  }

  // Wait for the active ViewMap's scroller to be wired up — app.js exposes
  // it on window.__dd._app once Application.start finishes.
  await page.waitForFunction(
    () => {
      const w = window as unknown as DDHook;
      return typeof w.__dd?.getZoom === 'function' && w.__dd.getZoom() !== null;
    },
    undefined,
    { timeout: 50_000 }
  );

  const getZoom = () =>
    page.evaluate(() => (window as unknown as DDHook).__dd?.getZoom?.() ?? null);

  // Zoom out programmatically — using the scroller API directly keeps the
  // test independent of the wheel-zoom easing curve and the +/- step size.
  await page.evaluate(() => (window as unknown as DDHook).__dd?.setZoom?.(0.6));

  // Confirm we're actually away from 1.0 before clicking the button —
  // a no-op pass would silently mask a regression.
  await expect.poll(getZoom, { timeout: 2_000 }).toBeLessThan(0.95);

  // Imperium and Database each have their own ZoomControls; we want the
  // Imperium one (the default visible view).  Dispatch the click event
  // directly on the element rather than going through page.click — the
  // first-launch tutorial popup overlay sits above the ZoomControls and
  // intercepts even force:true clicks via pointer-events routing.
  await page.evaluate(() => {
    const btn = document.querySelector<HTMLElement>('#Imperium .ZoomControls .Fullscreen');
    btn?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });

  // Scroller animation duration is 300 ms; allow some headroom.
  await expect.poll(getZoom, { timeout: 3_000 }).toBeCloseTo(1, 2);
});
