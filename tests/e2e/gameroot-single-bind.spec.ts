/**
 * Regression: Game.init() runs GameNode.init() on the GameRoot twice — once
 * from the constructor, once from loadGame().  `$(this)` re-wraps the same
 * jQuery data store, so every GameRoot handler used to be bound twice and a
 * single saveCoordsQueue sent two setPerpCoordinates updates.
 */

import { expect, test } from '@playwright/test';

test('GameRoot: one saveCoordsQueue trigger calls setPerpCoordinates once', async ({ page }) => {
  await page.goto('/?devtools=1');
  await expect(page.locator('[data-testid="game-container"]')).toBeVisible({
    timeout: 50_000,
  });

  const calls = await page.evaluate(() => {
    const app = (window as any).require('app').getApplication();
    const orig = app.remote.setPerpCoordinates;
    let n = 0;
    app.remote.setPerpCoordinates = () => {
      n++;
    };
    try {
      app.game.trigger('saveCoordsQueue', ['x', { x: 0, y: 0 }]);
    } finally {
      app.remote.setPerpCoordinates = orig;
    }
    return n;
  });
  expect(calls).toBe(1);
});
