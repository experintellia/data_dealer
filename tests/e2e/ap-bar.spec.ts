/**
 * AP (energy) bar visual update test.
 *
 * Asserts the statusbar's AP indicator visually decrements when a charge
 * action consumes 1 AP — the same property #119 broke at the engine level
 * (cash/AP drift between UI and state) and #120's architectural fix
 * structurally rules out. This is a regression guard that the *visual*
 * bar follows engine state across the listener-echo path.
 *
 * Strategy mirrors gameplay.spec.ts: drive the engine via RequireJS, then
 * sync the in-page Game layer's statusbar via game.updateGameValues so
 * the data-testid DOM nodes reflect the new values.
 *
 * Perp used: contact035 — price=0, charge_cost=60, charge_time=30s,
 * game_type=ContactPerp.
 */

import { test, expect } from '@playwright/test';

const GESTALT = 'contact035';
const PATH    = `Imperium.${GESTALT}`;

test('energy bar: charge action decrements visual AP value and bar width', async ({ page }) => {
  await page.goto('/?devtools=1');
  await expect(page.locator('[data-testid="game-container"]')).toBeVisible({
    timeout: 50_000,
  });
  await expect(page.locator('[data-testid="dd-ap-counter"]')).toBeVisible();

  // ── 1. Read initial AP from the engine (authoritative) ───────────────────
  const initial = await page.evaluate(async () => {
    const boot = await new Promise<any>((res, rej) =>
      (window as any).require(['boot'], res, rej),
    );
    const gv = boot.getState().game_values;
    return { ap: gv.ap_snapshot as number, ap_max: gv.ap_max as number };
  });

  // Fresh game starts with full AP per default_game.json (ap_snapshot=6).
  expect(initial.ap).toBeGreaterThan(0);
  expect(initial.ap_max).toBeGreaterThan(initial.ap - 1);

  // ── 2. Capture the initial visual bar width as a reference ───────────────
  // Read the inline style.width set by the statusbar template — that's
  // the value driven by D.AP_barsize and animated by FXSimpleCue. Reading
  // it as a string avoids races with the animation's interpolated frames.
  const readBarWidth = async () =>
    page.locator('[data-testid="dd-ap-bar"]').evaluate((el) =>
      parseFloat((el as HTMLElement).style.width || '0'),
    );
  const initialBarWidth = await readBarWidth();
  expect(initialBarWidth).toBeGreaterThan(0);

  // ── 3. Buy + charge contact035 — chargePerp consumes exactly 1 AP ────────
  const chargeResult = await page.evaluate(async (args) => {
    const eng = await new Promise<any>((res, rej) =>
      (window as any).require(['LocalEngine'], res, rej),
    );
    await eng.buyPerp('Imperium', args.gestalt);
    return eng.chargePerp(args.path);
  }, { gestalt: GESTALT, path: PATH });

  expect(chargeResult.result).not.toHaveProperty('error');
  const apAfter = chargeResult.result.game_values.ap_snapshot as number;
  // Engine-level invariant: chargePerp deducts exactly one AP
  // (or refills to ap_max on a level-up, which contact035 cannot trigger
  // from a fresh game's xp_value=0).
  expect(apAfter).toBe(initial.ap - 1);

  // ── 4. Sync the in-page Game layer so the statusbar template re-renders ──
  await page.evaluate((gv) => {
    const appModule: any = (window as any).require('app');
    const game: any =
      appModule && appModule.getApplication && appModule.getApplication().game;
    if (game) game.updateGameValues(gv);
  }, chargeResult.result.game_values);

  // ── 5. Assert the DOM reflects the new AP value ──────────────────────────
  // The statusbar StatusText prints "<AP_val>/<AP_max>". After updateGameValues
  // the FX animation completes in ~250ms, so use a short timeout.
  const expectedText = `${apAfter}/${initial.ap_max}`;
  await expect(page.locator('[data-testid="dd-ap-value"]')).toHaveText(expectedText, {
    timeout: 2_000,
  });

  // ── 6. Assert the visual bar width also shrank ───────────────────────────
  // The StatusGraph's `width:<%= D.AP_barsize %>px` is recomputed
  // proportionally on every setAP — at ap_max-1 / ap_max the bar should be
  // strictly narrower than at full AP. Use expect.poll so the FXSimpleCue
  // animation (~250ms) is allowed to settle before the assertion.
  await expect
    .poll(readBarWidth, { timeout: 2_000 })
    .toBeLessThan(initialBarWidth);
});
