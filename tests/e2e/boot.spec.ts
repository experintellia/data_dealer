/**
 * Boot smoke test — verifies that the game loads in a real Chromium browser,
 * the loading screen disappears, the game container appears, and no JS errors
 * are thrown during startup.
 *
 * The spritesheet and AMD module graph can take 10–30 s to load, so the
 * timeout is set at the suite level rather than relying on Playwright's
 * default.  All game clock interactions use window.__dd (devtools=1) so
 * real wall-clock time is never slept on.
 */

import { expect, test } from '@playwright/test';

test('boot: loader disappears and game container is visible', async ({ page }) => {
  const jsErrors: string[] = [];
  page.on('console', (msg) => {
    // Collect JS error messages so we can fail with a useful diagnostic.
    // Ignore favicon 404s — those are harmless and expected in dev.
    if (msg.type() === 'error' && !msg.text().includes('favicon')) {
      jsErrors.push(msg.text());
    }
  });
  page.on('pageerror', (err) => {
    jsErrors.push(err.message);
  });

  await page.goto('/?devtools=1');

  // The loader is replaced by game.html once bootstrap.js finishes the
  // full getToken → loadGame → Game.init() chain.
  await expect(page.locator('[data-testid="game-container"]')).toBeVisible({
    timeout: 50_000,
  });

  // The loader element should no longer exist in the DOM once the game has
  // rendered (bootstrap.js replaces #dd-control's innerHTML with game.html).
  await expect(page.locator('[data-testid="dd-loader"]')).not.toBeAttached();

  // No JS errors during startup.
  expect(jsErrors, `JS errors during boot: ${jsErrors.join(' | ')}`).toHaveLength(0);
});

test('boot: window.__dd clock hook is exposed with devtools=1', async ({ page }) => {
  await page.goto('/?devtools=1');
  await expect(page.locator('[data-testid="game-container"]')).toBeVisible({
    timeout: 50_000,
  });

  const hasHook = await page.evaluate(() => {
    return (
      typeof (window as Window & { __dd?: unknown }).__dd === 'object' &&
      typeof (window as Window & { __dd?: { advanceNow?: unknown } }).__dd?.advanceNow ===
        'function'
    );
  });
  expect(hasHook, 'window.__dd.advanceNow should be available with ?devtools=1').toBe(true);
});
