/**
 * Regression guard for issue #153: a `silent` updateGameValues must
 * still refresh the statusbar's DOM. The bug was that `setAP` skipped
 * `FXUpdateAP` on silent paths, leaving the template-bound flat
 * `AP_val` prop stale until something else forced a re-render.
 */

import { test, expect } from '@playwright/test';

test('energy stat: silent updateGameValues still refreshes statusbar text (issue #153)', async ({
  page,
}) => {
  await page.goto('/?devtools=1');
  await expect(page.locator('[data-testid="game-container"]')).toBeVisible({
    timeout: 50_000,
  });
  await expect(page.locator('[data-testid="dd-ap-counter"]')).toBeVisible();

  const initial = await page.evaluate(async () => {
    const boot = await new Promise<any>((res, rej) => (window as any).require(['boot'], res, rej));
    const gv = boot.getState().game_values;
    return { ap: gv.ap_snapshot as number, ap_max: gv.ap_max as number };
  });
  expect(initial.ap).toBeGreaterThan(0);

  await expect(page.locator('[data-testid="dd-ap-value"]')).toHaveText(
    `${initial.ap}/${initial.ap_max}`,
    { timeout: 2_000 }
  );

  const apAfter = initial.ap - 1;
  await page.evaluate(
    (args) => {
      const appModule: any = (window as any).require('app');
      const game: any = appModule && appModule.getApplication && appModule.getApplication().game;
      if (!game) throw new Error('game layer not initialised');
      game.updateGameValues({ ap_snapshot: args.apAfter }, false, undefined, true);
    },
    { apAfter }
  );

  await expect(page.locator('[data-testid="dd-ap-value"]')).toHaveText(
    `${apAfter}/${initial.ap_max}`,
    { timeout: 2_000 }
  );

  const consistency = await page.evaluate(() => {
    const appModule: any = (window as any).require('app');
    const game: any = appModule.getApplication().game;
    return {
      ap_value: game.ap_value as number,
      sb_AP_val: game.data.status_bar.AP.val as number,
      statusbar_AP_val: game.renderStatusbar.AP_val as number,
    };
  });
  expect(consistency.ap_value).toBe(apAfter);
  expect(consistency.sb_AP_val).toBe(apAfter);
  expect(consistency.statusbar_AP_val).toBe(apAfter);
});
