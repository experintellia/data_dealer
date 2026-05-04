/**
 * Regression test for issue #153 — energy stat displays an incorrect value
 * until the player clicks it.
 *
 * Root cause
 * ----------
 * `GameRoot.setAP/setCash/setProfiles/setKarma/setXP` used to gate the
 * statusbar updater on `!silent`:
 *
 *   if (this.renderStatusbar && !silent) { this.renderStatusbar.FXUpdateAP(); }
 *
 * `updateGameValues` is called *twice* on integrateCollected — first with
 * `silent=true` and then again without silent. The first call updated
 * `groot.ap_value` and `sb.AP.val` but skipped `FXUpdateAP`, so the
 * Statusbar's flat `AP_val` prop (the one bound to the DOM template)
 * never got refreshed. The second call hit the `gv.ap_snapshot ===
 * groot.ap_value` equality guard and short-circuited, so `FXUpdateAP`
 * was never invoked. Result: the statusbar text lagged the engine
 * until something else triggered a re-render.
 *
 * The popup `click_status.AP` handler reads `gnode.ap_value` directly
 * (not `sb.AP.val`), which is why opening the dialog showed the
 * correct number — making the bug look like the dialog was "fixing"
 * the value.
 *
 * Fix
 * ---
 * Always invoke the statusbar updaters; pass `silent` through so the
 * `FXUpdate*` helpers can choose `dur=0` (instant) instead of `dur=250`
 * (animated). The flat statusbar props are then kept in sync on every
 * mutation, silent or not.
 *
 * Strategy
 * --------
 * Reproduce the exact integrateCollected sequence:
 *  1. Read initial AP from the engine, then
 *  2. Drive the in-page Game layer with `updateGameValues({...},_,_,true)`
 *     — i.e. silent — using a different ap_snapshot.
 *  3. Assert the visible statusbar text already reflects the new AP
 *     *without* a follow-up non-silent call. Before the fix it stays at
 *     the old number; after the fix it matches `apAfter/ap_max`.
 */

import { test, expect } from '@playwright/test';

test('energy stat: silent updateGameValues still refreshes statusbar text (issue #153)', async ({ page }) => {
  await page.goto('/?devtools=1');
  await expect(page.locator('[data-testid="game-container"]')).toBeVisible({
    timeout: 50_000,
  });
  await expect(page.locator('[data-testid="dd-ap-counter"]')).toBeVisible();

  // ── 1. Read initial AP from the engine. ──────────────────────────────
  const initial = await page.evaluate(async () => {
    const boot = await new Promise<any>((res, rej) =>
      (window as any).require(['boot'], res, rej),
    );
    const gv = boot.getState().game_values;
    return { ap: gv.ap_snapshot as number, ap_max: gv.ap_max as number };
  });
  expect(initial.ap).toBeGreaterThan(0);

  // Confirm the statusbar's initial render matches.
  await expect(page.locator('[data-testid="dd-ap-value"]')).toHaveText(
    `${initial.ap}/${initial.ap_max}`,
    { timeout: 2_000 },
  );

  // ── 2. Drive a SILENT updateGameValues — the same code path
  //       integrateCollected uses on the first call. Before the fix
  //       this would mutate `ap_value` + `sb.AP.val` but never refresh
  //       the Statusbar's flat `AP_val` prop. ────────────────────────────
  const apAfter = initial.ap - 1;
  await page.evaluate((args) => {
    const appModule: any = (window as any).require('app');
    const game: any =
      appModule && appModule.getApplication && appModule.getApplication().game;
    if (!game) throw new Error('game layer not initialised');
    game.updateGameValues({ ap_snapshot: args.apAfter }, false, undefined, true);
  }, { apAfter });

  // ── 3. The DOM must reflect the silent update without anyone clicking
  //       the AP indicator. Allow a frame for the dur=0 tween to tick. ───
  await expect(page.locator('[data-testid="dd-ap-value"]')).toHaveText(
    `${apAfter}/${initial.ap_max}`,
    { timeout: 2_000 },
  );

  // Sanity: gnode.ap_value (the popup source) and sb.AP.val (the
  // statusbar source) must agree — the bug was specifically that the
  // Statusbar's AP_val prop diverged from both.
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
