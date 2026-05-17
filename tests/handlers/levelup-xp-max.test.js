// @ts-nocheck — strict-TS quarantine; remove when this file is migrated to TS (issue #147)
/**
 * Regression: level-up must fire when xp_value reaches the level's xp_max,
 * not only when it crosses into the next level's xp_min.
 *
 * Ruleset levels have a gap between consecutive ranges:
 *   L1: xp_min=0, xp_max=10
 *   L2: xp_min=11, xp_max=30
 *
 * Pre-fix `_getLevelByXP` matched the inclusive upper bound first
 * (`xp >= xp_min && xp <= xp_max`), so a player at xp=10 stayed at level 1
 * until a stray +1 XP pushed them to 11. Visible symptom: "10/10" bar
 * sitting at level 1 with no levelup notification — and chained
 * symptoms like `buyPerp('proxy001')` failing the `required_level=2`
 * check because the player was still level 1.
 *
 * Fix: treat xp_max as the promotion threshold — reaching it returns
 * the next level.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buyPerp, setEmitter, setSendAchievement } from '../../scripts/LocalEngine.js';
import { getState, setState } from '../../scripts/boot.js';
import { installWebxdc, setSendDelta, uninstallWebxdc } from './_webxdc-harness.js';

beforeEach(async () => {
  await installWebxdc();
});
afterEach(() => {
  uninstallWebxdc();
});
import { clearOverride, setOverride } from '../../scripts/clock.js';
import { FIXED_NOW, mkGv, mkState } from './_fixtures.js';

function mkAchievementSpy() {
  const spy = vi.fn();
  setSendAchievement(spy);
  return spy;
}

function callsOfKind(spy, achievementKind) {
  return spy.mock.calls.filter((c) => c[0].payload.achievement_kind === achievementKind);
}

describe('levelup — fires when xp lands exactly on xp_max', () => {
  beforeEach(() => {
    setOverride(FIXED_NOW);
    setState(
      mkState({
        display_name: 'Eve',
        locale: 'en',
        // xp_value=9, xp_level=1; buying client007 (xp_inc=1) lands
        // xp_value at exactly 10, which equals L1's xp_max. Pre-fix this
        // did NOT level up; post-fix it must.
        game_values: mkGv({ xp_value: 9, xp_level: 1, cash_value: 5000 }),
      })
    );
  });

  afterEach(() => {
    clearOverride();
    setSendAchievement(null);
    setSendDelta(null);
    setEmitter(null);
  });

  it('promotes xp_level when xp_value reaches xp_max exactly', async () => {
    const spy = mkAchievementSpy();

    await buyPerp('Imperium', 'client007');

    const gv = getState().game_values;
    expect(gv.xp_value).toBe(10);
    // The promotion threshold is L1.xp_max=10 → new level is 2.
    expect(gv.xp_level).toBe(2);
    // And the levelup achievement fires once.
    expect(callsOfKind(spy, 'levelup')).toHaveLength(1);
  });

  it('does not fire levelup when xp_value stays below xp_max', async () => {
    // Reset to a state where buyPerp keeps xp below xp_max.
    setState(
      mkState({
        display_name: 'Eve',
        locale: 'en',
        game_values: mkGv({ xp_value: 5, xp_level: 1, cash_value: 5000 }),
      })
    );
    const spy = mkAchievementSpy();

    await buyPerp('Imperium', 'client007');

    const gv = getState().game_values;
    expect(gv.xp_value).toBe(6);
    expect(gv.xp_level).toBe(1);
    expect(callsOfKind(spy, 'levelup')).toHaveLength(0);
  });
});
