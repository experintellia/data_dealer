/**
 * Issue #103 — weighted-average share merge for the Database token bars.
 *
 * Drives the LocalEngine directly (matches gameplay.spec.ts strategy: no
 * sprite clicks) to assert two invariants the upstream
 * `dd_app/dd_calc.py:Database.merge` formula was supposed to guarantee:
 *
 *   1. Tokens absent from a new profileset are diluted as the DB grows
 *      (so the per-tile bar moves *down* as well as up).
 *   2. After several integrations the status-bar `crosssum` stays well
 *      below 100 % whenever no single token is present in every merged
 *      profileset (so the orange bar is no longer "always full").
 *
 * The pre-fix port clamp-summed per-integration deltas, which against a
 * ruleset where every `tokens[].amount === 100` saturated every share at
 * 100 % after one merge.  Both invariants would fail under that
 * implementation, so this spec is a regression target for the fix.
 */

import { expect, test } from '@playwright/test';
import { installSettle } from './_helpers';

test.beforeEach(async ({ page }) => {
  await installSettle(page);
  await page.goto('/?devtools=1');
  await expect(page.locator('[data-testid="game-container"]')).toBeVisible({
    timeout: 50_000,
  });
});

test('integrate dilutes untouched token shares + crosssum stays under 100', async ({ page }) => {
  // Seed two crafted db_queue entries through `boot.setState` /
  // `LocalEngine.integrateCollected` — keeps the test independent of
  // ruleset price/level gates and the canvas-heavy buy/charge flow.
  const result = await page.evaluate(async () => {
    const boot = await new Promise<{
      getState(): any;
      setState(s: any): void;
    }>((res, rej) => (window as any).require(['boot'], res, rej));
    const eng = await new Promise<any>((res, rej) =>
      (window as any).require(['LocalEngine'], res, rej)
    );

    const state = boot.getState();
    // Generous AP to cover both integrations (each costs 1 AP).
    state.game_values = Object.assign({}, state.game_values, {
      ap_snapshot: 10,
      profiles_value: 0,
    });
    state.db_queue = [
      {
        origin: 'Imperium.test.contactA',
        collect_id: 'cq_test_a',
        profile_set: {
          profiles_value: 200,
          tokens_map: { token008: { amount: 100 }, token084: { amount: 100 } },
        },
      },
      {
        origin: 'Imperium.test.contactB',
        collect_id: 'cq_test_b',
        profile_set: {
          profiles_value: 200,
          tokens_map: { token008: { amount: 100 }, token128: { amount: 100 } },
        },
      },
    ];
    state.integrated_ids = {};
    boot.setState(state);

    const settle = (window as any).__ddSettle as (p: (s: any) => boolean) => Promise<unknown>;
    // Each integrate only SENDS; the listener applies it asynchronously and is
    // the sole mutator. The second merge must run on the post-first state, and
    // the final read must see both applied.
    await eng.integrateCollected('cq_test_a');
    await settle((s) => !!(s.integrated_ids && s.integrated_ids.cq_test_a));
    await eng.integrateCollected('cq_test_b');
    await settle((s) => !!(s.integrated_ids && s.integrated_ids.cq_test_b));

    const finalNodes = boot.getState().nodes.filter((n: any) => n.game_type === 'TokenPerp');
    const byGestalt: Record<string, number> = {};
    finalNodes.forEach((n: any) => {
      byGestalt[n.gestalt] = (n.instance_data && n.instance_data.amount) || 0;
    });
    const crosssumDenom = finalNodes.length + 1;
    const crosssum =
      finalNodes.reduce(
        (acc: number, n: any) => acc + ((n.instance_data && n.instance_data.amount) || 0),
        0
      ) / crosssumDenom;
    return {
      shares: byGestalt,
      profiles_value: boot.getState().game_values.profiles_value,
      tokenCount: finalNodes.length,
      crosssum,
    };
  });

  // Both profilesets contributed 200 profiles; total = 400.
  expect(result.profiles_value).toBe(400);

  // token008 in every profileset → stays at 100 %.
  expect(result.shares.token008).toBeCloseTo(100, 6);
  // token084 only in PS1 → diluted to 50 % after PS2 lands.
  expect(result.shares.token084).toBeCloseTo(50, 6);
  // token128 only in PS2 → seeded share = 100 * 200 / 400 = 50.
  expect(result.shares.token128).toBeCloseTo(50, 6);

  // Mean of {100, 50, 50} = 66.6 ≈ what the orange `crosssum` bar shows.
  // The off-by-one (count+1) divisor in getDBTokensCrossSum brings it down
  // a notch further. Either way it must be visibly below 100.
  expect(result.crosssum).toBeLessThan(80);
  expect(result.crosssum).toBeGreaterThan(0);
});

test('integrating the same profileset twice does not change shares (N = 0 dup replay)', async ({
  page,
}) => {
  const out = await page.evaluate(async () => {
    const boot = await new Promise<any>((res, rej) => (window as any).require(['boot'], res, rej));
    const eng = await new Promise<any>((res, rej) =>
      (window as any).require(['LocalEngine'], res, rej)
    );

    const state = boot.getState();
    state.game_values = Object.assign({}, state.game_values, {
      ap_snapshot: 10,
      profiles_value: 0,
    });
    state.db_queue = [
      {
        origin: 'Imperium.test.contactA',
        collect_id: 'cq_dup_test',
        profile_set: {
          profiles_value: 100,
          tokens_map: { token008: { amount: 100 } },
        },
      },
    ];
    state.integrated_ids = {};
    boot.setState(state);

    const settle = (window as any).__ddSettle as (p: (s: any) => boolean) => Promise<unknown>;
    await eng.integrateCollected('cq_dup_test');
    await settle((s) => !!(s.integrated_ids && s.integrated_ids.cq_dup_test));
    const afterFirst = boot.getState();
    const shareAfterFirst =
      afterFirst.nodes.find((n: any) => n.gestalt === 'token008')?.instance_data?.amount ?? null;
    const profilesAfterFirst = afterFirst.game_values.profiles_value;

    // Re-queue the same collect_id and replay — handler should treat it as a
    // duplicate (N = 0), neither growing profiles_value nor changing shares.
    const replayState = boot.getState();
    replayState.db_queue = [
      {
        origin: 'Imperium.test.contactA',
        collect_id: 'cq_dup_test',
        profile_set: {
          profiles_value: 100,
          tokens_map: { token008: { amount: 100 } },
        },
      },
    ];
    boot.setState(replayState);

    await eng.integrateCollected('cq_dup_test');
    const afterReplay = boot.getState();
    const shareAfterReplay =
      afterReplay.nodes.find((n: any) => n.gestalt === 'token008')?.instance_data?.amount ?? null;
    const profilesAfterReplay = afterReplay.game_values.profiles_value;

    return {
      shareAfterFirst,
      shareAfterReplay,
      profilesAfterFirst,
      profilesAfterReplay,
    };
  });

  expect(out.shareAfterFirst).toBeCloseTo(100, 6);
  // biome-ignore lint/style/noNonNullAssertion: shareAfterFirst is always set by the evaluate block above
  expect(out.shareAfterReplay).toBeCloseTo(out.shareAfterFirst!, 6);
  expect(out.profilesAfterReplay).toBe(out.profilesAfterFirst);
});
