/**
 * Sweepstakes (project001) upgrade purchase test.
 *
 * Verifies that buyPowerup succeeds on a ProjectPerp node when the player has
 * sufficient cash.  This is a regression test for the bug reported in issue
 * #122: "I have enough money but I can't buy the upgrades for the
 * sweepstakes/lottery."
 *
 * We call LocalEngine directly (not through the canvas UI) for the same
 * reasons as gameplay.spec.ts.
 *
 * State injection: the default game starts with 270 cash and xp_level 1, but
 * project001 costs 300 and its cheapest upgrade (upgrade001) costs 160 and
 * requires xp_level 2.  We use boot.setState() to raise both values before
 * calling the handlers.
 *
 * project001 type_data (ruleset_3.de.json):
 *   price:           300
 *   required_level:  2
 *   upgrade_slots:   3
 *   provided_upgrades[0]: { gestalt: 'upgrade001', price: 160, required_level: 2 }
 */

import { test, expect } from '@playwright/test';

test('sweepstakes: buyPowerup succeeds with sufficient cash after buying project001', async ({ page }) => {
  await page.goto('/?devtools=1');
  await expect(page.locator('[data-testid="game-container"]')).toBeVisible({
    timeout: 50_000,
  });

  // ── Inject state with enough cash and the right XP level ─────────────────
  // project001 costs 300, upgrade001 costs 160; we need xp_level >= 2 to buy
  // project001 and to unlock upgrade001 in the ruleset.
  await page.evaluate(async () => {
    const boot = await new Promise<any>((res, rej) =>
      (window as any).require(['boot'], res, rej),
    );
    const state = boot.getState();
    boot.setState(
      Object.assign({}, state, {
        game_values: Object.assign({}, state.game_values, {
          cash_value: 1000,
          xp_level: 2,
          xp_value: 20,
        }),
      }),
    );
  });

  // ── Step 1: Buy project001 (the sweepstakes node) ─────────────────────────
  const buyPerpResult = await page.evaluate(async () => {
    const eng = await new Promise<any>((res, rej) =>
      (window as any).require(['LocalEngine'], res, rej),
    );
    return eng.buyPerp('Imperium', 'project001');
  });

  expect(buyPerpResult.result).not.toHaveProperty('error');
  // cash 1000 - price 300 = 700
  expect(buyPerpResult.result.game_values.cash_value).toBe(700);

  // ── Step 2: Buy upgrade001 on slot 0 — this is the reported failing path ──
  const buyPowerupResult = await page.evaluate(async () => {
    const eng = await new Promise<any>((res, rej) =>
      (window as any).require(['LocalEngine'], res, rej),
    );
    // slot is intentionally passed as a string, matching what the browser UI
    // sends via data-button-data attributes.
    return eng.buyPowerup('Imperium.project001', '0', 'upgrade001');
  });

  // Must succeed — no error property in result.
  expect(buyPowerupResult.result).not.toHaveProperty('error');
  // cash 700 - upgrade price 160 = 540
  expect(buyPowerupResult.result.game_values.cash_value).toBe(540);
  // The returned node must carry the new powerup in its instance_data.
  expect(buyPowerupResult.result.node.instance_data.powerups).toHaveLength(1);
  expect(buyPowerupResult.result.node.instance_data.powerups[0]).toMatchObject({
    slot: '0',
    gestalt: 'upgrade001',
  });
});

test('sweepstakes: buyPowerup returns error 3 when cash is insufficient', async ({ page }) => {
  await page.goto('/?devtools=1');
  await expect(page.locator('[data-testid="game-container"]')).toBeVisible({
    timeout: 50_000,
  });

  // Inject state with just enough cash to buy the perp but not the upgrade.
  // project001 costs 300; upgrade001 costs 160.  Give exactly 300 so after
  // buying the perp there is 0 cash left.
  await page.evaluate(async () => {
    const boot = await new Promise<any>((res, rej) =>
      (window as any).require(['boot'], res, rej),
    );
    const state = boot.getState();
    boot.setState(
      Object.assign({}, state, {
        game_values: Object.assign({}, state.game_values, {
          cash_value: 300,
          xp_level: 2,
          xp_value: 20,
        }),
      }),
    );
  });

  // Buy the perp (spends all 300 cash).
  const buyPerpResult = await page.evaluate(async () => {
    const eng = await new Promise<any>((res, rej) =>
      (window as any).require(['LocalEngine'], res, rej),
    );
    return eng.buyPerp('Imperium', 'project001');
  });
  expect(buyPerpResult.result).not.toHaveProperty('error');
  expect(buyPerpResult.result.game_values.cash_value).toBe(0);

  // Now try to buy upgrade001 — should fail with error 3 (insufficient cash).
  const buyPowerupResult = await page.evaluate(async () => {
    const eng = await new Promise<any>((res, rej) =>
      (window as any).require(['LocalEngine'], res, rej),
    );
    return eng.buyPowerup('Imperium.project001', '0', 'upgrade001');
  });
  expect(buyPowerupResult.result).toMatchObject({ error: 3 });
});

test('sweepstakes: buyPowerup returns error 0 when node does not exist', async ({ page }) => {
  await page.goto('/?devtools=1');
  await expect(page.locator('[data-testid="game-container"]')).toBeVisible({
    timeout: 50_000,
  });

  // Do NOT buy project001 first — the node does not exist in state.
  const result = await page.evaluate(async () => {
    const eng = await new Promise<any>((res, rej) =>
      (window as any).require(['LocalEngine'], res, rej),
    );
    return eng.buyPowerup('Imperium.project001', '0', 'upgrade001');
  });
  // error 0 = node/type not found
  expect(result.result).toMatchObject({ error: 0 });
});
