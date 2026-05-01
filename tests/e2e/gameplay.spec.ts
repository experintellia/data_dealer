/**
 * Gameplay integration test — exercises the full buy→charge→idle-skip→
 * collect→integrate cycle.
 *
 * Strategy
 * --------
 * We call LocalEngine methods directly through RequireJS so we don't need
 * to click through the sprite-based game UI (which is non-deterministic and
 * canvas-heavy).  After each state-changing engine call we sync the in-page
 * Game layer's statusbar so the data-testid DOM assertions see the new values.
 *
 * Clock skipping
 * --------------
 * window.__dd.advanceNow(ms) moves the injectable clock forward.  collectPerp
 * and integrateCollected both call materialize(state, clockNow()) internally,
 * so advancing the clock before calling collectPerp is sufficient — no real
 * wall-clock setTimeout needs to fire.
 *
 * Perp used: contact035
 *   price:        0        (free to buy; cash starts at 270)
 *   charge_cost:  60       (cash decreases by 60 on charge)
 *   charge_time:  30 000 ms
 *   collect_amount: 1 100  (profiles gained after integrate)
 *   game_type:    ContactPerp → produces a db_queue entry on collectPerp
 */

import { test, expect } from '@playwright/test';

// Gestalt and path of the perp used across this spec.
const GESTALT = 'contact035';
const PATH = `Imperium.${GESTALT}`;
// charge_time from the ruleset + a small safety margin.
const CHARGE_MS = 30_000 + 500;

// Helper: require an AMD module from inside the page and return its value.
// Must be called inside page.evaluate().
function amdGet(modId: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).require([modId], resolve, reject);
  });
}

test('gameplay: buy→charge→skip→collect→integrate decreases cash and increases profileCount', async ({ page }) => {
  await page.goto('/?devtools=1');
  await expect(page.locator('[data-testid="game-container"]')).toBeVisible({
    timeout: 50_000,
  });

  // ── 1. Read initial values from the engine (authoritative state) ──────────
  const initial = await page.evaluate(async () => {
    const boot = await new Promise<{ getState(): { game_values: { cash_value: number; profiles_value: number } } }>(
      (res, rej) => (window as any).require(['boot'], res, rej),
    );
    const gv = boot.getState().game_values;
    return { cash: gv.cash_value, profiles: gv.profiles_value };
  });

  // Fresh game starts with 270 cash and 0 profiles (from default_game.json).
  expect(initial.cash).toBe(270);
  expect(initial.profiles).toBe(0);

  // ── 2. Buy contact035 (price=0, no cash change) ───────────────────────────
  const buyResult = await page.evaluate(async (gestalt) => {
    const eng = await new Promise<any>((res, rej) => (window as any).require(['LocalEngine'], res, rej));
    const res = await eng.buyPerp('tok', 'Imperium', gestalt);
    return res;
  }, GESTALT);
  expect(buyResult.result).not.toHaveProperty('error');
  // price=0 so cash unchanged after buy.
  expect(buyResult.result.game_values.cash_value).toBe(initial.cash);

  // ── 3. Charge the perp (charge_cost=60 → cash decreases) ─────────────────
  const chargeResult = await page.evaluate(async (path) => {
    const eng = await new Promise<any>((res, rej) => (window as any).require(['LocalEngine'], res, rej));
    const res = await eng.chargePerp('tok', path);
    return res;
  }, PATH);
  expect(chargeResult.result).not.toHaveProperty('error');
  const cashAfterCharge = chargeResult.result.game_values.cash_value;
  expect(cashAfterCharge).toBeLessThan(initial.cash); // charge_cost=60

  // ── 4. Advance injectable clock past charge_end ───────────────────────────
  // collectPerp calls materialize(state, clockNow()) internally, so this is
  // sufficient to make the charge appear "done" — no real timer need fire.
  await page.evaluate((ms) => {
    (window as any).__dd.advanceNow(ms);
  }, CHARGE_MS);

  // ── 5. Collect (ContactPerp path: creates a db_queue entry) ──────────────
  const collectResult = await page.evaluate(async (path) => {
    const eng = await new Promise<any>((res, rej) => (window as any).require(['LocalEngine'], res, rej));
    const res = await eng.collectPerp('tok', path);
    return res;
  }, PATH);
  expect(collectResult.result.result).not.toHaveProperty('error');
  const collectId: string = collectResult.result.result.collect_id;
  expect(collectId).toBeTruthy();

  // ── 6. Integrate (increases profiles_value in state) ─────────────────────
  const intResult = await page.evaluate(async (id) => {
    const eng = await new Promise<any>((res, rej) => (window as any).require(['LocalEngine'], res, rej));
    const res = await eng.integrateCollected('tok', id);
    return res;
  }, collectId);
  expect(intResult.result.result.increment).toBeGreaterThan(0);

  const finalGv: { cash_value: number; profiles_value: number } = intResult.result.game_values;
  expect(finalGv.profiles_value).toBeGreaterThan(initial.profiles);

  // ── 7. Sync the in-page Game layer so DOM testids reflect new values ──────
  // Use the same updateGameValues path the game normally uses after engine calls.
  // Without silent=true the FX animation runs (~250ms) and re-renders statusbar.
  await page.evaluate((gv: { cash_value: number; profiles_value: number }) => {
    const appModule: any = (window as any).require('app');
    const game: any = appModule && appModule.getApplication && appModule.getApplication().game;
    if (!game) return;
    game.updateGameValues(gv);
  }, finalGv);

  // ── 8. Assert DOM ─────────────────────────────────────────────────────────
  // After updateGameValues, the statusbar FX animation completes in ~250ms and
  // re-renders the template.  Use not.toHaveText with a short timeout so
  // Playwright waits for the animation rather than asserting immediately.
  await expect(page.locator('[data-testid="cash-value"]')).not.toHaveText('270', { timeout: 2000 });
  await expect(page.locator('[data-testid="profiles-value"]')).not.toHaveText('0', { timeout: 2000 });
});
