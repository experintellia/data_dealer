/**
 * The `FXBling({ text: $${cash} })` overlay in `scripts/game/ClientPerp.ts`
 * reads `inner.cash` from the `collectPerp` response. The engine used to
 * return `cash: newGv.cash_value` (the player's new running total), so
 * the overlay flashed e.g. `$47.882` over a single client whenever the
 * player had $47,842 banked and just collected $40. The engine now
 * returns the gain, so the overlay matches what was just collected.
 *
 * Drives the engine directly (no canvas clicks), matching the strategy
 * in `share-merge.spec.ts` and `collect-icon-after-charge.spec.ts`.
 */

import { expect, test } from '@playwright/test';

test('ClientPerp collect: response carries the cash gain, not the new total', async ({ page }) => {
  await page.goto('/?devtools=1');
  await expect(page.locator('[data-testid="game-container"]')).toBeVisible({
    timeout: 50_000,
  });

  const out = await page.evaluate(async () => {
    const boot = await new Promise<any>((res, rej) => (window as any).require(['boot'], res, rej));
    const eng = await new Promise<any>((res, rej) =>
      (window as any).require(['LocalEngine'], res, rej)
    );

    const path = 'Imperium.test.City.test.Pusher.test.client.test';
    const state = boot.getState();
    state.game_values = Object.assign({}, state.game_values, {
      cash_value: 47_842,
      ap_snapshot: 10,
    });
    state.nodes = [
      ...(state.nodes ?? []),
      {
        full_path: path,
        game_type: 'ClientPerp',
        full_type: 'ClientPerp:test',
        gestalt: 'client_test_money_overlay',
        instance_data: {},
      },
    ];
    state.nodes_collect = [{ path, result: { amount: 40 } }];
    boot.setState(state);

    const { result } = await eng.collectPerp(path);
    return {
      cash: result.result.cash,
      cashValueAfter: result.game_values?.cash_value,
    };
  });

  expect(out.cash).toBe(40);
  expect(out.cashValueAfter).toBe(47_882);
});
