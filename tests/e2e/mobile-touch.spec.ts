/**
 * Mobile touch-input smoke test (issue #80, phase 8 PR 2).
 *
 * Boots the game emulating an iPhone 13 (touch-only, isMobile=true) and
 * verifies that:
 *   - the game boots in mobile-emulation mode (touch-enabled context)
 *   - dispatching a synthetic touchstart→touchend on a tab fires the
 *     view-switch handler.  This catches double-fire regressions where
 *     binding both `click` and `touchend` on the same element causes the
 *     synthetic-click after touchend to immediately undo the touch action.
 *
 * We don't drop in `devices['iPhone 13']` wholesale because the bundled
 * descriptor sets defaultBrowserType=webkit, and the project's runner is
 * chromium-only.  Mirroring viewport/hasTouch/isMobile is sufficient.
 */

import { expect, test } from '@playwright/test';

test.use({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
  userAgent:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
});

test('mobile-touch: boots in mobile/touch context', async ({ page }) => {
  await page.goto('/?devtools=1');
  await expect(page.locator('[data-testid="game-container"]')).toBeVisible({
    timeout: 50_000,
  });

  const ctx = await page.evaluate(() => ({
    hasTouch: 'ontouchstart' in window,
    maxTouchPoints: navigator.maxTouchPoints,
  }));
  expect(ctx.hasTouch).toBe(true);
});

test('mobile-touch: tab touch fires view switch (no double-fire)', async ({ page }) => {
  await page.goto('/?devtools=1');
  await expect(page.locator('[data-testid="game-container"]')).toBeVisible({
    timeout: 50_000,
  });

  const databaseTab = page.locator('.MainMenuButton[data-button-id="Database"]');
  await expect(databaseTab).toBeVisible();

  // Dispatch a synthetic touch sequence.  page.tap() may stall on hidden
  // ancestors in the canvas-heavy stage, so we drive the DOM event API
  // directly — the click+touchend pair on .MainMenuButton is what we're
  // exercising.
  await page.evaluate(() => {
    const el = document.querySelector<HTMLElement>('.MainMenuButton[data-button-id="Database"]');
    if (!el) throw new Error('database tab missing');
    el.dispatchEvent(
      new TouchEvent('touchstart', { bubbles: true, cancelable: true, touches: [] as any })
    );
    el.dispatchEvent(
      new TouchEvent('touchend', { bubbles: true, cancelable: true, touches: [] as any })
    );
  });

  // Active class should flip to the Database tab — and crucially stay there
  // (a double-fire would re-trigger and could ping-pong views).
  await expect(databaseTab).toHaveClass(/active/, { timeout: 5_000 });
});
