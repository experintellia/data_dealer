// @ts-nocheck — strict-TS quarantine; remove when this file is migrated to TS (issue #147)
/**
 * Mission-reward XP must count toward the level-up check.
 *
 * dd_app computes `new_xp = old xp + xp_increment + rewards xp` and runs
 * `_handle_levelup` once on that total (views.py buyPerp / chargePerp /
 * collectPerp / integrateCollected).  The port checked the level before
 * folding in the mission rewards, so XP from a completed mission that
 * crossed a threshold left the player on the old level with no popup.
 *
 * Levels: L1 xp 0–10 (promotes at 10, ap_max 8 on L2).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buyPerp,
  buyPowerup,
  chargePerp,
  collectPerp,
  integrateCollected,
  setSendAchievement,
} from '../../scripts/LocalEngine.js';
import { getState, setState } from '../../scripts/boot.js';
import { clearOverride, setOverride } from '../../scripts/clock.js';
import { FIXED_NOW, mkGv, mkNode, mkState } from './_fixtures.js';
import { installWebxdc, uninstallWebxdc } from './_webxdc-harness.js';

let spy;
beforeEach(async () => {
  await installWebxdc();
  setOverride(FIXED_NOW);
  spy = vi.fn();
  setSendAchievement(spy);
});
afterEach(() => {
  setSendAchievement(null);
  clearOverride();
  uninstallWebxdc();
});

function goal(mission, workflow, target, amount) {
  return { mission, workflow, target, amount, position: 1, current_amount: 0, complete: false };
}

function expectLevelUp(result, xp) {
  expect(result.missions.complete_missions.length).toBe(1);
  expect(result.game_values.xp_value).toBe(xp);
  expect(result.levelup).toBe(true);
  expect(result.game_values.xp_level).toBe(2);
  expect(result.game_values.ap_max).toBe(8);
  expect(getState().game_values.xp_level).toBe(2);
  const levelups = spy.mock.calls.filter((c) => c[0].payload.achievement_kind === 'levelup');
  expect(levelups).toHaveLength(1);
}

describe('mission-reward XP triggers the level-up', () => {
  it('collectPerp: mission001 reward (+2 XP) lifts xp 7 → 10 to level 2', async () => {
    const PATH = 'Imperium.City.Agent0.contact035';
    setState(
      mkState({
        nodes: [mkNode('ContactPerp', PATH)],
        nodes_collect: [{ path: PATH, result: { amount: 1100 } }],
        active_missions: ['mission001'],
        mission_goals: [goal('mission001', 'collect_profiles', 'contact035', 900)],
        game_values: mkGv({ xp_value: 7 }),
      })
    );
    const { result } = await collectPerp(PATH);
    expectLevelUp(result, 10);
  });

  it('chargePerp: mission003 reward (+1 XP) lifts xp 8 → 10 to level 2', async () => {
    const PATH = 'Imperium.city002.pusher004.client007';
    setState(
      mkState({
        nodes: [mkNode('ClientPerp', PATH)],
        active_missions: ['mission003'],
        mission_goals: [goal('mission003', 'charge_perp', 'client007', null)],
        game_values: mkGv({ xp_value: 8 }),
      })
    );
    const { result } = await chargePerp(PATH);
    expectLevelUp(result, 10);
  });

  it('integrateCollected: mission002 reward (+1 XP) lifts xp 9 → 10 to level 2', async () => {
    setState(
      mkState({
        active_missions: ['mission002'],
        mission_goals: [goal('mission002', 'integrate_profiles', 'token008', 900)],
        db_queue: [
          {
            origin: 'Imperium.City.Agent0.contact035',
            collect_id: 'c1',
            profile_set: { profiles_value: 1100, tokens_map: { token008: { amount: 100 } } },
            collect_dt: FIXED_NOW,
          },
        ],
        game_values: mkGv({ xp_value: 9 }),
      })
    );
    const { result } = await integrateCollected('c1');
    expectLevelUp(result, 10);
  });

  it('buyPerp: buy_perp mission reward (+1 XP) lifts xp 9 → 10 to level 2', async () => {
    const MISSION = 'dc481d7863ceb18575c50d36e2c5ecfe000'; // buy_perp pusher003
    setState(
      mkState({
        active_missions: [MISSION],
        mission_goals: [goal(MISSION, 'buy_perp', 'pusher003', null)],
        game_values: mkGv({ xp_value: 9, cash_value: 5000 }),
      })
    );
    const { result } = await buyPerp('Imperium', 'pusher003');
    expectLevelUp(result, 10);
  });

  it('buyPowerup: mission006 reward (+3 XP) lifts xp 5 → 10 to level 2', async () => {
    const P001 = 'Imperium.project001';
    const done = (g) => Object.assign(g, { complete: true });
    setState(
      mkState({
        nodes: [mkNode('ProjectPerp', P001)],
        active_missions: ['mission006'],
        mission_goals: [
          done(goal('mission006', 'buy_powerup', 'upgrade001', null)),
          done(goal('mission006', 'buy_powerup', 'ad002', null)),
          goal('mission006', 'buy_powerup', 'teammember020', null),
        ],
        game_values: mkGv({ xp_value: 5, cash_value: 5000 }),
      })
    );
    const { result } = await buyPowerup(P001, 0, 'teammember020');
    expectLevelUp(result, 10);
  });
});
