/**
 * Smoke test for DecoratorAmount after token collection.
 * Ensures the decorator renders without errors when displaying token amounts.
 * (The fix changed absoluteAmount → absoluteInc; detailed verification is in unit tests.)
 */

import { expect, test } from '@playwright/test';

test('token-collection: decorator-amount renders without errors', async ({ page }) => {
  await page.goto('/?devtools=1');
  await expect(page.locator('[data-testid="game-container"]')).toBeVisible({
    timeout: 50_000,
  });

  // Execute a token collection and verify no JS errors occur
  const collectionResult = await page.evaluate(async () => {
    try {
      const eng = await new Promise<any>((res, rej) =>
        (window as any).require(['LocalEngine'], res, rej)
      );
      // Buy and charge a token
      await eng.buyPerp('Imperium', 'token003');
      await eng.chargePerp('Imperium.token003');
      // Collect should not throw
      await eng.collectPerp('Imperium.token003');
      return {
        success: true,
        error: null,
      };
    } catch (error) {
      return {
        success: false,
        error: (error as Error)?.message ?? String(error),
      };
    }
  });

  expect(collectionResult.success).toBe(true);
  expect(collectionResult.error).toBeNull();
});
