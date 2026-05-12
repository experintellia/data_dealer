/**
 * Preventive Checkup (project009) upgrade-tokens e2e.
 *
 * End-to-end regression for the "bought upgrade, data points still
 * greyed out" bug. The unit tests in tests/handlers/upgradeTokens.test.js
 * pin down the LocalEngine contract; this spec exercises the same flow
 * inside the real boot pipeline so a regression in the runtime wiring
 * (boot/setState, loadGame's repair pass) gets caught too.
 *
 * project009 base venture tokens list token018 / token053 / token125 with
 * amount: 0 (gated by Blood test, upgrade073). The ProfileSet popup runs
 * with lockAmountZero=true, so any token still at amount 0 after the
 * upgrade is bought would render greyed in the UI.
 */

import { expect, test } from '@playwright/test';

const PROJECT_PATH = 'Imperium.CityVienna.project009';
const PROJECT_NODE = {
  game_id: 'node_project009',
  game_type: 'ProjectPerp',
  full_type: 'ProjectPerp:project009',
  gestalt: 'project009',
  full_path: PROJECT_PATH,
  instance_data: { powerups: [] },
};

async function seedProjectState(page: import('@playwright/test').Page) {
  await page.evaluate(
    async ({ projectNode }) => {
      const boot = await new Promise<any>((res, rej) =>
        (window as any).require(['boot'], res, rej)
      );
      const state = boot.getState();
      boot.setState(
        Object.assign({}, state, {
          nodes: state.nodes.concat([projectNode]),
          game_values: Object.assign({}, state.game_values, {
            cash_value: 5000,
            xp_level: 15,
            xp_value: 500,
            ap_snapshot: 6,
            ap_max: 6,
          }),
          node_counter: (state.node_counter || 0) + 1,
        })
      );
    },
    { projectNode: PROJECT_NODE }
  );
}

test('preventive checkup: Blood test unlocks token018/053/125 in instance_data', async ({
  page,
}) => {
  await page.goto('/?devtools=1');
  await expect(page.locator('[data-testid="game-container"]')).toBeVisible({ timeout: 50_000 });

  await seedProjectState(page);

  const result = await page.evaluate(async (path) => {
    const eng = await new Promise<any>((res, rej) =>
      (window as any).require(['LocalEngine'], res, rej)
    );
    return eng.buyPowerup(path, 0, 'upgrade073');
  }, PROJECT_PATH);

  expect(result.result).not.toHaveProperty('error');

  const tokens = result.result.node.instance_data.tokens;
  const byGestalt: Record<string, number> = {};
  for (const t of tokens) byGestalt[t.gestalt] = t.amount;

  // upgrade073 (Blood test) raises token018=25, token053=25, token125=100.
  expect(byGestalt.token018).toBe(25);
  expect(byGestalt.token053).toBe(25);
  expect(byGestalt.token125).toBe(100);
  // Always-on base tokens stay at 100.
  expect(byGestalt.token001).toBe(100);
  expect(byGestalt.token007).toBe(100);
});

test('preventive checkup: loadGame repairs unmerged tokens on cold start', async ({ page }) => {
  await page.goto('/?devtools=1');
  await expect(page.locator('[data-testid="game-container"]')).toBeVisible({ timeout: 50_000 });

  // Seed a legacy-shaped node: powerup already installed, but tokens stuck
  // at the unmerged base values (the shape a pre-fix save would carry).
  await page.evaluate(async () => {
    const boot = await new Promise<any>((res, rej) => (window as any).require(['boot'], res, rej));
    const state = boot.getState();
    boot.setState(
      Object.assign({}, state, {
        nodes: state.nodes.concat([
          {
            game_id: 'node_project009',
            game_type: 'ProjectPerp',
            full_type: 'ProjectPerp:project009',
            gestalt: 'project009',
            full_path: 'Imperium.CityVienna.project009',
            instance_data: {
              powerups: [
                { slot: 0, gestalt: 'upgrade073', full_type: 'UpgradePowerup:upgrade073' },
              ],
              tokens: [
                { gestalt: 'token001', amount: 100, full_type: 'TokenPerp:token001' },
                { gestalt: 'token018', amount: 0, full_type: 'TokenPerp:token018' },
                { gestalt: 'token053', amount: 0, full_type: 'TokenPerp:token053' },
                { gestalt: 'token125', amount: 0, full_type: 'TokenPerp:token125' },
              ],
            },
          },
        ]),
        node_counter: (state.node_counter || 0) + 5,
      })
    );
  });

  // Invoke loadGame — the path a cold reload would take.
  await page.evaluate(async () => {
    const eng = await new Promise<any>((res, rej) =>
      (window as any).require(['LocalEngine'], res, rej)
    );
    await eng.loadGame();
  });

  // Read post-repair state and assert the upgrade-gated tokens are unlocked.
  const tokens = await page.evaluate(async () => {
    const boot = await new Promise<any>((res, rej) => (window as any).require(['boot'], res, rej));
    const node = boot
      .getState()
      .nodes.find((n: { full_path: string }) => n.full_path === 'Imperium.CityVienna.project009');
    return node.instance_data.tokens;
  });
  const byGestalt: Record<string, number> = {};
  for (const t of tokens) byGestalt[t.gestalt] = t.amount;

  expect(byGestalt.token018).toBe(25);
  expect(byGestalt.token053).toBe(25);
  expect(byGestalt.token125).toBe(100);
  expect(byGestalt.token001).toBe(100);
});
