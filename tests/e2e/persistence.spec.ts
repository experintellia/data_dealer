/**
 * Persistence test — verifies that game state survives a page reload.
 *
 * The webxdc dev-mode mock (@webxdc/vite-plugins) stores sendUpdate payloads
 * in localStorage under "webxdc-dev-updates" (or equivalent key).  On every
 * cold start boot.js replays the full history via setUpdateListener, so any
 * delta committed before the reload must be visible after it.
 *
 * What we test
 * ────────────
 * 1. Charge a perp (chargePerp commits a delta that decrements cash and
 *    records a nodes_charging entry).
 * 2. Read the post-charge cash value from the engine state.
 * 3. Reload the page (full navigation — localStorage is preserved).
 * 4. Wait for the game to finish booting again.
 * 5. Read cash from the engine state again — it must equal the value from
 *    step 2, proving the delta was replayed correctly.
 *
 * Perp used: contact035  (price=0, charge_cost=60, game_type=ContactPerp)
 * Starting cash: 270 → 210 after charge.
 */

import { expect, test } from '@playwright/test';

const GESTALT = 'contact035';
const PATH = `Imperium.${GESTALT}`;

async function waitForGameReady(page: import('@playwright/test').Page) {
  await expect(page.locator('[data-testid="game-container"]')).toBeVisible({
    timeout: 50_000,
  });
}

test('persistence: state is restored after page reload', async ({ page }) => {
  await page.goto('/?devtools=1');
  await waitForGameReady(page);

  // ── Buy then charge the perp ──────────────────────────────────────────────
  await page.evaluate(async (gestalt) => {
    const eng = await new Promise<any>((res, rej) =>
      (window as any).require(['LocalEngine'], res, rej)
    );
    await eng.buyPerp('Imperium', gestalt);
  }, GESTALT);

  const { cashAfterCharge } = await page.evaluate(async (path) => {
    const eng = await new Promise<any>((res, rej) =>
      (window as any).require(['LocalEngine'], res, rej)
    );
    const result = await eng.chargePerp(path);
    return { cashAfterCharge: result.result.game_values.cash_value };
  }, PATH);

  expect(cashAfterCharge).toBeLessThan(270); // charge_cost=60 was applied

  // ── Reload (localStorage survives — webxdc mock persists deltas there) ───
  await page.reload();
  await waitForGameReady(page);

  // ── Verify state was replayed correctly ───────────────────────────────────
  const cashAfterReload = await page.evaluate(async () => {
    const boot = await new Promise<any>((res, rej) => (window as any).require(['boot'], res, rej));
    return boot.getState().game_values.cash_value;
  });

  expect(cashAfterReload).toBe(cashAfterCharge);
});
