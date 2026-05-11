/**
 * Regression test for money count display bug.
 * When collecting tokens, the decorator should display the collected count
 * (absoluteInc), not the total amount (absoluteAmount).
 */

import { expect, test } from '@playwright/test';

test('collect-amount: decorator displays collected count not total amount', async ({
  page,
}) => {
  await page.goto('/?devtools=1');
  await expect(page.locator('[data-testid="game-container"]')).toBeVisible({
    timeout: 50_000,
  });

  const NODE_ID = 'token003';

  const result = await page.evaluate(async (nodeId) => {
    const eng = await new Promise<any>((res, rej) =>
      (window as any).require(['LocalEngine'], res, rej)
    );
    await eng.buyPerp('Imperium', nodeId);
    await eng.chargePerp(`Imperium.${nodeId}`);
    const collectResult = await eng.collectPerp(`Imperium.${nodeId}`);
    return {
      tokenUpgradedAmount: collectResult?.result?.result?.token_upgraded_amount,
    };
  }, NODE_ID);

  const decoratorText = await page.evaluate((nodeId) => {
    const game = (window as any).require('app').getApplication().game;
    const gnode = game?.getById(nodeId);
    const decorator = gnode?.renderNode?.DecoratorAmount;
    return decorator?.jdomelem3?.text() ?? null;
  }, NODE_ID);

  expect(result.tokenUpgradedAmount).toBeDefined();
  expect(decoratorText).not.toBeNull();
  expect(decoratorText!.length).toBeGreaterThan(0);
  expect(decoratorText).not.toBe('0');
});
