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

import { expect, test } from '@playwright/test';
import { bootGame } from './_helpers';

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

test('zoom-controls: zoom buttons still animate after a camera scrollTo', async ({ page }) => {
  // RenderViewMap.scrollTo() used to leave `scroller.options.animating`
  // false, and Zynga only tweens zooms / flick-decelerates while it is
  // true — so after the first camera move every zoom jumped instantly.
  await bootGame(page);
  const r = await page.evaluate(() => {
    const vm = (window as any).__dd._app.game.activeView.renderNode;
    vm.scroller.zoomTo(1, false);
    vm.scrollTo({ x: 1024, y: 840 }, 0);
    const instantScroll = !vm.scroller.__isAnimating;
    const animatingAfterScrollTo = vm.scroller.options.animating;
    document
      .querySelector<HTMLElement>('#Imperium .ZoomControls .ZoomOut')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    return { instantScroll, animatingAfterScrollTo, tweening: !!vm.scroller.__isAnimating };
  });
  expect(r.instantScroll, 'scrollTo(pos, 0) moves without a tween').toBe(true);
  expect(r.animatingAfterScrollTo).toBe(true);
  expect(r.tweening, 'ZoomOut starts a tween instead of jumping').toBe(true);
});

test('zoom-controls: a zoom tween survives refits, camera moves and a second click', async ({
  page,
}) => {
  // A refit (window resize / MainMenu ResizeObserver → fitToWindow →
  // updateScroller), a tab switch, a tutorial camera move or the debounced
  // re-centre all re-publish "the current zoom".  Mid-tween that is a
  // transient value, and Zynga stopped the reset tween right there.
  await bootGame(page);
  for (const followUp of ['fitToWindow', 'switchView', 'cameraMove', 'center']) {
    const zoom = await page.evaluate(async (followUp) => {
      const game = (window as any).__dd._app.game;
      const vm = game.activeView.renderNode;
      vm.scroller.zoomTo(0.6, false);
      document
        .querySelector<HTMLElement>('#Imperium .ZoomControls .Fullscreen')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      if (followUp === 'fitToWindow') game.fitToWindow();
      if (followUp === 'switchView') game.trigger('switch_view', ['Imperium']);
      if (followUp === 'cameraMove') vm.scrollTo({ x: 1024, y: 840 }, 300);
      if (followUp === 'center') game._centerActiveView(false);
      await new Promise((r) => setTimeout(r, 1000));
      return vm.scroller.__zoomLevel;
    }, followUp);
    expect(zoom, `zoom after a ${followUp} during the reset tween`).toBeCloseTo(1, 2);
  }

  // A quick double-click steps twice: 0.625 → 0.875 → 1, not 0.625 → ~0.875
  // twice because the second step started from the first tween's frame.
  const doubleZoomIn = await page.evaluate(async () => {
    const vm = (window as any).__dd._app.game.activeView.renderNode;
    vm.scroller.zoomTo(0.6, false);
    const zoomIn = () =>
      document
        .querySelector<HTMLElement>('#Imperium .ZoomControls .ZoomIn')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    zoomIn();
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    zoomIn();
    await new Promise((r) => setTimeout(r, 1000));
    return vm.scroller.__zoomLevel;
  });
  expect(doubleZoomIn, 'zoom after a quick ZoomIn double-click').toBeCloseTo(1, 2);
});
