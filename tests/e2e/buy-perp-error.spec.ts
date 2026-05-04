/**
 * Insufficient-cash buyPerp error test (optional scenario from issue #48).
 *
 * Verifies that attempting to buy a perp whose price exceeds the player's
 * current cash returns the expected error code (2 = insufficient cash) from
 * LocalEngine.buyPerp.
 *
 * We deliberately call the engine rather than clicking through the UI because
 * the buy slot is rendered in canvas/sprite space and has no stable DOM anchor
 * before Thread BB (#47) adds the full testid set for game-board elements.
 *
 * Perp used: client006 — price 400, required_level 1.
 * Starting cash: 270 (default_game.json) → 270 < 400 → error 2.
 */

import { expect, test } from '@playwright/test';

test('buy-perp: insufficient cash returns error code 2', async ({ page }) => {
  await page.goto('/?devtools=1');
  await expect(page.locator('[data-testid="game-container"]')).toBeVisible({
    timeout: 50_000,
  });

  const result = await page.evaluate(async () => {
    const eng = await new Promise<any>((res, rej) =>
      (window as any).require(['LocalEngine'], res, rej)
    );
    // client006 costs 400 cash; starting cash is 270 → should fail.
    return eng.buyPerp('Imperium', 'client006');
  });

  // LocalEngine.buyPerp returns { result: { error: 2 } } for insufficient cash.
  expect(result.result).toMatchObject({ error: 2 });
});
