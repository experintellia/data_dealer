// @ts-nocheck — strict-TS quarantine; remove when this file is migrated to TS (issue #147)
/**
 * "New items" notifications (`new_items` events consumed by
 * GameRoot.makeNotifications).
 *
 * dd_app defers two Celery tasks (countdown=2) that push `new_items`:
 *   - notifyLevelupItems after every level-up: perps whose required_level is
 *     the new level (Agent/Contact/Proxy/Project/City types) plus, per owned
 *     project, the powerups requiring it (rules get_levelup_items /
 *     get_levelup_powerups);
 *   - notifyBuyperpItems after buying a project/contact the player did not
 *     own yet: the clients/pushers it now provides
 *     (get_new_consumers_for_provider).
 *
 * Level 2 unlocks project001 + proxy001 and twelve project001 powerups.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buyKarma,
  buyPerp,
  buyPowerup,
  buySlots,
  chargePerp,
  collectPerp,
  integrateCollected,
  loadGame,
  recheckMissions,
  sellPowerup,
  setEmitter,
} from '../../scripts/LocalEngine.js';
import { setState } from '../../scripts/boot.js';
import { clearOverride, setOverride } from '../../scripts/clock.js';
import { FIXED_NOW, mkGv, mkNode, mkState } from './_fixtures.js';
import { installWebxdc, uninstallWebxdc } from './_webxdc-harness.js';

const P001 = 'Imperium.project001';
const JESSICA = 'Imperium.City.Agent0.contact035';
const LEVEL2_POWERUPS = [
  'ad001',
  'ad002',
  'ad003',
  'ad004',
  'ad010',
  'teammember014',
  'teammember015',
  'teammember020',
  'teammember021',
  'upgrade001',
  'upgrade002',
  'upgrade004',
];

let events;
beforeEach(async () => {
  await installWebxdc();
  vi.useFakeTimers();
  setOverride(FIXED_NOW);
  events = [];
  setEmitter((ev, pl) => {
    if (ev === 'new_items') events.push(pl);
  });
});
afterEach(() => {
  setEmitter(null);
  clearOverride();
  vi.useRealTimers();
  uninstallWebxdc();
});

function seed(xp, extra) {
  setState(
    mkState(
      Object.assign(
        {
          nodes: [mkNode('ProjectPerp', P001), mkNode('ContactPerp', JESSICA)],
          game_values: mkGv({ xp_value: xp, cash_value: 5000 }),
        },
        extra
      )
    )
  );
}

// Deferred like dd_app's countdown=2 so GameRoot has applied the handler
// response (new xp_level) before makeNotifications runs.
async function levelupNotice() {
  await Promise.resolve();
  expect(events.filter((e) => e.trigger === 'levelup')).toHaveLength(0);
  vi.advanceTimersByTime(2000);
  const notices = events.filter((e) => e.trigger === 'levelup');
  expect(notices).toHaveLength(1);
  return notices[0];
}

function expectLevel2Items(notice) {
  expect(notice.level).toBe(2);
  expect(notice.perps.slice().sort()).toEqual(['project001', 'proxy001']);
  expect(Object.keys(notice.powerups)).toEqual(['project001']);
  const pus = notice.powerups.project001;
  expect(pus.map((p) => p.game_gestalt).sort()).toEqual(LEVEL2_POWERUPS);
  // Same entry shape as getPowerups — GameRoot addType()s it onto the project.
  for (const p of pus) {
    expect(typeof p.game_type).toBe('string');
    expect(p.type_data.required_level).toBe(2);
  }
}

const goal = (mission, workflow, target, amount, current) => ({
  mission,
  workflow,
  target,
  amount,
  position: 1,
  current_amount: current || 0,
  complete: false,
});

describe('new_items after a level-up — every level-up site', () => {
  const cases = [
    ['buyKarma', 5, {}, () => buyKarma('karma001')],
    ['buyPowerup', 8, {}, () => buyPowerup(P001, 0, 'ad002')],
    [
      'sellPowerup',
      9,
      {
        nodes: [
          mkNode('ProjectPerp', P001, {
            powerups: [{ slot: 0, gestalt: 'ad002', full_type: 'AdPowerup:ad002' }],
          }),
        ],
      },
      () => sellPowerup(P001, 0, 'ad002'),
    ],
    ['buySlots', 9, {}, () => buySlots(P001, 'ad', 1)],
    ['buyPerp', 9, {}, () => buyPerp('Imperium', 'client007')],
    ['chargePerp', 9, {}, () => chargePerp(JESSICA)],
    [
      'collectPerp',
      9,
      { nodes_collect: [{ path: JESSICA, result: { amount: 10 } }] },
      () => collectPerp(JESSICA),
    ],
    [
      'integrateCollected',
      9,
      {
        db_queue: [
          { origin: JESSICA, collect_id: 'c1', profile_set: { profiles_value: 0, xp_gain: 1 } },
        ],
      },
      () => integrateCollected('c1'),
    ],
    [
      'recheckMissions',
      8,
      {
        active_missions: ['mission001'],
        mission_goals: [goal('mission001', 'collect_profiles', 'contact035', 900, 900)],
      },
      () => recheckMissions(),
    ],
  ];

  it.each(cases)('%s', async (_name, xp, extra, call) => {
    seed(xp, extra);
    const { result } = await call();
    expect(result.levelup || result.result?.levelup).toBeTruthy();
    expectLevel2Items(await levelupNotice());
  });

  it('loadGame startup repair', async () => {
    seed(8, {
      active_missions: ['mission001'],
      mission_goals: [goal('mission001', 'collect_profiles', 'contact035', 900, 900)],
    });
    await loadGame();
    expectLevel2Items(await levelupNotice());
  });

  it('only notifies powerups for owned projects', async () => {
    seed(5, { nodes: [] });
    await buyKarma('karma001');
    const notice = await levelupNotice();
    expect(notice.perps.slice().sort()).toEqual(['project001', 'proxy001']);
    expect(notice.powerups).toEqual({});
  });

  it('no level-up → no levelup notice', async () => {
    seed(1);
    await chargePerp(JESSICA);
    await Promise.resolve();
    vi.advanceTimersByTime(2000);
    expect(events).toEqual([]);
  });
});

describe('new_items after buying a new provider (notifyBuyperpItems)', () => {
  it('first contact035 announces the consumers it provides', async () => {
    seed(1, { nodes: [] });
    await buyPerp('Imperium', 'contact035');
    vi.advanceTimersByTime(2000);
    expect(events).toHaveLength(1);
    expect(events[0].trigger).toBe('buy_provider');
    expect(events[0].provider).toBe('contact035');
    expect(events[0].level).toBe(1);
    expect(events[0].perps.slice().sort()).toEqual(['client007', 'pusher004']);
  });

  it('a second contact035 announces nothing', async () => {
    seed(1);
    await buyPerp('Imperium', 'contact035');
    vi.advanceTimersByTime(2000);
    expect(events).toEqual([]);
  });

  it('non-provider gestalts (client/city/…) announce nothing', async () => {
    seed(1);
    await buyPerp('Imperium', 'client007');
    vi.advanceTimersByTime(2000);
    expect(events).toEqual([]);
  });
});
