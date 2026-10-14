// @ts-nocheck — strict-TS quarantine; remove when this file is migrated to TS (issue #147)
/**
 * Charging an upgradeable TokenPerp (super tokens and the other
 * `contained_tokens` entries) must yield a token increment.
 *
 * dd_app chargecollect.py CollectableToken.getPerpChargeData merges each
 * contained token's new-since-last-upgrade share (weighted by
 * contained_tokens[].amount) into the token via dd_merger.py UpgradeToken /
 * dd_calc.py Database.merge; collectPerp adds that increment, rescaled by
 * charge-time / current profiles_value and capped at 100.  The port priced the
 * charge from collect_amount / income_base, which token types don't have, so
 * every token charge paid 0.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { chargePerp, collectPerp, setPrngSeed } from '../../scripts/LocalEngine.js';
import { getState, setState } from '../../scripts/boot.js';
import { clearOverride, setOverride } from '../../scripts/clock.js';
import { FIXED_NOW, mkGv, mkNode, mkState } from './_fixtures.js';
import { installWebxdc, uninstallWebxdc } from './_webxdc-harness.js';

beforeEach(async () => {
  await installWebxdc();
  setOverride(FIXED_NOW);
  setPrngSeed(42);
});
afterEach(() => {
  clearOverride();
  uninstallWebxdc();
});

function tok(gestalt, amount) {
  return mkNode('TokenPerp', 'Database.' + gestalt, { amount });
}

async function chargeThenCollect(path, gvAtCollect) {
  const { result } = await chargePerp(path);
  expect(result.error).toBeUndefined();
  const amount = getState().nodes_charging[0].result.amount;
  const s = getState();
  setState(
    Object.assign({}, s, { game_values: Object.assign({}, s.game_values, gvAtCollect || {}) })
  );
  setOverride(s.nodes_charging[0].charge_end + 1);
  const collected = await collectPerp(path);
  return { amount, upgraded: collected.result.result.token_upgraded_amount };
}

describe('chargePerp/collectPerp — TokenPerp upgrade increment', () => {
  // Full database (profiles_value == profiles_max) makes Database.merge
  // deterministic: token007 holds 10, its only contained token001 (weight 75)
  // holds 80 → usable share 60 → presum 30 → max(10, (10+30)/2) + 10/1000.
  it('token007 from a full DB: increment 10.01, collected amount 20.01', async () => {
    setState(
      mkState({
        nodes: [tok('token007', 10), tok('token001', 80)],
        game_values: mkGv({ profiles_value: 1000, profiles_max: 1000 }),
      })
    );
    const { amount, upgraded } = await chargeThenCollect('Database.token007');
    expect(amount).toBeCloseTo(10.01, 9);
    expect(upgraded).toBeCloseTo(20.01, 9);
  });

  it('supertoken002 at 10 gains a positive increment', async () => {
    setState(
      mkState({
        nodes: [
          tok('supertoken002', 10),
          tok('token125', 60),
          tok('token018', 40),
          tok('token114', 30),
        ],
        game_values: mkGv({ profiles_value: 400, profiles_max: 1000 }),
      })
    );
    const { amount, upgraded } = await chargeThenCollect('Database.supertoken002');
    expect(amount).toBeGreaterThan(0);
    expect(upgraded).toBeCloseTo(10 + amount, 9);
  });

  it('collect rescales by charge-time / current profiles_value and caps at 100', async () => {
    const seed = () =>
      setState(
        mkState({
          nodes: [tok('token007', 10), tok('token001', 80)],
          game_values: mkGv({ profiles_value: 1000, profiles_max: 100000 }),
        })
      );
    seed();
    const halved = await chargeThenCollect('Database.token007', { profiles_value: 2000 });
    expect(halved.amount).toBeGreaterThan(0);
    expect(halved.upgraded).toBeCloseTo(10 + halved.amount / 2, 9);

    seed();
    const capped = await chargeThenCollect('Database.token007', { profiles_value: 250 });
    expect(capped.amount * 4).toBeGreaterThan(90);
    expect(capped.upgraded).toBe(100);
  });
});
