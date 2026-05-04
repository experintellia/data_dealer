/**
 * Regression test for the missing collect icon after a charge completes.
 * The legacy socket.on('node_ready') bridge that re-fired engine events
 * onto per-gnode listeners was removed in #142; without a replacement in
 * scripts/app.js, the timer decorator stays put and DecoratorReady is
 * never added.
 */

import { test, expect, type Page } from '@playwright/test';

const GESTALT = 'contact035';

async function waitForGameReady(page: Page) {
  await expect(page.locator('[data-testid="game-container"]')).toBeVisible({
    timeout: 50_000,
  });
}

async function getGnodeState(page: Page, gestalt: string) {
  return page.evaluate((id) => {
    const gnode = (window as any).require('app').getApplication().game.getById(id);
    return {
      exists:        !!gnode,
      chargeRunning: !!gnode.states.chargeRunning,
      hasReady:      !!gnode.renderReady,
    };
  }, gestalt);
}

test('collect-icon: DecoratorReady appears after node_ready emit (no stuck clock)', async ({ page }) => {
  await page.goto('/?devtools=1');
  await waitForGameReady(page);

  // Game.js was instantiated against a state where contact035 didn't
  // exist; the reload below lets it pick up the in-progress charge.
  await page.evaluate(async (gestalt) => {
    const eng = await new Promise<any>((res, rej) =>
      (window as any).require(['LocalEngine'], res, rej),
    );
    await eng.buyPerp('Imperium', gestalt);
    await eng.chargePerp(`Imperium.${gestalt}`);
  }, GESTALT);

  await page.reload();
  await waitForGameReady(page);

  await expect(page.locator('.DecoratorTimer').first()).toBeVisible({ timeout: 5_000 });
  expect(await getGnodeState(page, GESTALT)).toMatchObject({
    exists: true, chargeRunning: true, hasReady: false,
  });

  // _scheduleChargeReady's setTimeout uses wall-clock time (msUntil is
  // captured at schedule time and an override-clock advance won't fire
  // it early), so we publish the event directly instead of waiting 30 s.
  await page.evaluate((gestalt) => {
    const $ = (window as any).jQuery || (window as any).$;
    $(document).trigger('node_ready', [{
      id:     gestalt,
      type:   'ContactPerp',
      path:   `Imperium.${gestalt}`,
      result: { amount: 100 },
    }]);
  }, GESTALT);

  await expect(page.locator('[data-testid="dd-collect-ready"]')).toBeVisible({ timeout: 2_000 });
  expect(await getGnodeState(page, GESTALT)).toMatchObject({
    chargeRunning: false, hasReady: true,
  });
});
