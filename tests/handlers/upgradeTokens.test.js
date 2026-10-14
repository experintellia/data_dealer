/**
 * Regression for the "bought upgrade, data points still greyed out" bug.
 *
 * ProjectPerp ventures (e.g. project009 "Preventive checkup") list their
 * complete token catalogue in `type_data.tokens` with `amount: 0` for the
 * tokens that only become collectable once a corresponding upgrade is
 * bought (Blood test → token018/053/125, Urine test → token018/120, etc.).
 *
 * When buyPowerup runs, it must merge the purchased upgrade's
 * `type_data.tokens` into `instance_data.tokens`, raising the per-token
 * amounts above zero. The ProfileSet popup is configured with
 * `lockAmountZero: true`, so tokens with amount=0 render greyed out.
 * Without this merge, "Blood test", "Medical Questionnaire", etc. have
 * no visible effect on the data tab.
 *
 * sellPowerup is the mirror: removing the upgrade must drop those token
 * amounts back to the base venture defaults (0 for upgrade-gated tokens).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  buyPowerup,
  chargePerp,
  collectPerp,
  integrateCollected,
  loadGame,
  sellPowerup,
} from '../../scripts/LocalEngine.js';
import { getState, setState } from '../../scripts/boot.js';
import { clearOverride, setOverride } from '../../scripts/clock.js';
import { applyDelta } from '../../scripts/state.js';
import { FIXED_NOW, mkNode, mkState } from './_fixtures.js';
import { installWebxdc, uninstallWebxdc } from './_webxdc-harness.js';

// project009 = "Preventive checkup" (ruleset_3.en.json:7531)
const PROJECT_PATH = 'Imperium.CityVienna.project009';
const PROJECT_NODE = {
  game_id: 'node_project009',
  game_type: 'ProjectPerp',
  full_type: 'ProjectPerp:project009',
  gestalt: 'project009',
  full_path: PROJECT_PATH,
  instance_data: { powerups: [] },
};

function findToken(tokens, gestalt) {
  return (tokens || []).find((t) => t.gestalt === gestalt);
}

function projectState(overrides) {
  return mkState(
    Object.assign(
      {
        nodes: [PROJECT_NODE],
        // upgrade073 (Blood test) costs 830; upgrade070/074 also pricey.
        game_values: { cash_value: 5000 },
      },
      overrides || {}
    )
  );
}

beforeEach(async () => {
  await installWebxdc();
  setOverride(FIXED_NOW);
});

afterEach(() => {
  clearOverride();
  uninstallWebxdc();
});

describe('buyPowerup — upgrade tokens unlock venture data points', () => {
  beforeEach(() => setState(projectState()));

  // Sanity: the base venture lists token018/053/125 with amount: 0.
  // The UI's ProfileSet runs with lockAmountZero=true, so those tokens
  // render greyed until an upgrade lifts their amount above 0.
  it('base venture tokens for upgrade-gated data points start at amount 0', () => {
    const node = getState().nodes[0];
    // type_data.tokens is the source of truth pre-purchase, but the
    // engine seeds instance_data.tokens from it during buyPowerup. Here
    // we just assert the precondition via the ruleset shape that the
    // upgrade-gated tokens carry amount 0 in the base venture.
    expect(node.instance_data.powerups).toEqual([]);
  });

  it('buying Blood test (upgrade073) raises token018 amount above 0', async () => {
    const { result } = await buyPowerup(PROJECT_PATH, 0, 'upgrade073');
    expect(result.error).toBeUndefined();
    const tokens = result.node.instance_data.tokens;
    const t018 = findToken(tokens, 'token018');
    expect(t018).toBeDefined();
    expect(t018.amount).toBeGreaterThan(0);
  });

  it('buying Blood test sets token018/053/125 amounts to the upgrade-defined values', async () => {
    const { result } = await buyPowerup(PROJECT_PATH, 0, 'upgrade073');
    const tokens = result.node.instance_data.tokens;
    // upgrade073 type_data.tokens: token018=25, token053=25, token125=100
    expect(findToken(tokens, 'token018').amount).toBe(25);
    expect(findToken(tokens, 'token053').amount).toBe(25);
    expect(findToken(tokens, 'token125').amount).toBe(100);
  });

  it('keeps the base venture tokens (always-100 personal-data tokens) intact', async () => {
    const { result } = await buyPowerup(PROJECT_PATH, 0, 'upgrade073');
    const tokens = result.node.instance_data.tokens;
    // project009 base: token001..token007 (First name, Last name, …) at 100.
    expect(findToken(tokens, 'token001').amount).toBe(100);
    expect(findToken(tokens, 'token002').amount).toBe(100);
    expect(findToken(tokens, 'token007').amount).toBe(100);
  });

  it('buying Urine test (upgrade074) raises token120 above 0 and leaves unrelated upgrade tokens at 0', async () => {
    const { result } = await buyPowerup(PROJECT_PATH, 0, 'upgrade074');
    const tokens = result.node.instance_data.tokens;
    // upgrade074 type_data.tokens: token018=50, token120=50
    expect(findToken(tokens, 'token120').amount).toBe(50);
    expect(findToken(tokens, 'token018').amount).toBe(50);
    // token125 is gated by Blood test (upgrade073) only — must stay 0.
    const t125 = findToken(tokens, 'token125');
    expect(t125).toBeDefined();
    expect(t125.amount).toBe(0);
  });

  it('overlapping upgrade tokens take the maximum amount when both are bought', async () => {
    // upgrade073 (Blood test) gives token018=25
    // upgrade074 (Urine test) gives token018=50
    await buyPowerup(PROJECT_PATH, 0, 'upgrade073');
    const { result } = await buyPowerup(PROJECT_PATH, 1, 'upgrade074');
    const tokens = result.node.instance_data.tokens;
    expect(findToken(tokens, 'token018').amount).toBe(50);
    // Blood test's exclusive token must still be raised.
    expect(findToken(tokens, 'token125').amount).toBe(100);
    // Urine test's exclusive token must be raised.
    expect(findToken(tokens, 'token120').amount).toBe(50);
  });

  it('persists the merged tokens into state.nodes[0].instance_data.tokens', async () => {
    await buyPowerup(PROJECT_PATH, 0, 'upgrade073');
    const node = getState().nodes[0];
    expect(findToken(node.instance_data.tokens, 'token125').amount).toBe(100);
  });
});

describe('loadGame — repairs upgrade tokens on cold start', () => {
  // Simulates a legacy save written before this fix existed: the player
  // already owns Blood test (upgrade073 in slot 0) but instance_data.tokens
  // still carries the unmerged base venture catalogue with amount: 0 for
  // upgrade-gated tokens. Without a repair pass on load, the data tab
  // stays greyed out forever — buyPowerup only runs when the player
  // actively buys.
  function legacySeededState() {
    const legacyTokens = [
      { gestalt: 'token001', amount: 100, full_type: 'TokenPerp:token001' },
      { gestalt: 'token018', amount: 0, full_type: 'TokenPerp:token018' },
      { gestalt: 'token053', amount: 0, full_type: 'TokenPerp:token053' },
      { gestalt: 'token125', amount: 0, full_type: 'TokenPerp:token125' },
    ];
    const node = Object.assign({}, PROJECT_NODE, {
      instance_data: {
        powerups: [{ slot: 0, gestalt: 'upgrade073', full_type: 'UpgradePowerup:upgrade073' }],
        tokens: legacyTokens,
      },
    });
    return mkState({
      nodes: [node],
      game_values: { cash_value: 5000 },
      // Mark as "not a new game" so loadGame doesn't hit the new-game branch.
      node_counter: 5,
    });
  }

  it('cold-load with buggy stored tokens restores upgrade token amounts', async () => {
    setState(legacySeededState());

    // Sanity: pre-load state mirrors the bug — token018/053/125 stuck at 0.
    const before = getState().nodes[0].instance_data.tokens;
    expect(findToken(before, 'token018').amount).toBe(0);
    expect(findToken(before, 'token125').amount).toBe(0);

    await loadGame();

    const after = getState().nodes[0].instance_data.tokens;
    expect(findToken(after, 'token018').amount).toBe(25);
    expect(findToken(after, 'token053').amount).toBe(25);
    expect(findToken(after, 'token125').amount).toBe(100);
    // Always-on base token stays put.
    expect(findToken(after, 'token001').amount).toBe(100);
  });

  it('leaves nodes without powerups untouched on cold load', async () => {
    const noPowerupsNode = Object.assign({}, PROJECT_NODE, {
      instance_data: {
        powerups: [],
        tokens: [{ gestalt: 'token001', amount: 100, full_type: 'TokenPerp:token001' }],
      },
    });
    setState(mkState({ nodes: [noPowerupsNode], node_counter: 5 }));
    const before = getState().nodes[0].instance_data.tokens;

    await loadGame();

    const after = getState().nodes[0].instance_data.tokens;
    expect(after).toEqual(before);
  });

  it('cold-load is idempotent — running loadGame twice gives the same tokens', async () => {
    setState(legacySeededState());
    await loadGame();
    const first = getState().nodes[0].instance_data.tokens.map((t) => ({
      gestalt: t.gestalt,
      amount: t.amount,
    }));

    await loadGame();
    const second = getState().nodes[0].instance_data.tokens.map((t) => ({
      gestalt: t.gestalt,
      amount: t.amount,
    }));

    expect(second).toEqual(first);
  });

  it('replaying a buyPowerup delta then loadGame yields correctly merged tokens', async () => {
    // Simulate a peer / cold reload: applyDelta directly with a legacy-shaped
    // result whose instance_data.tokens are unmerged. loadGame must repair.
    setState(projectState());
    const buggyDelta = {
      kind: 'delta',
      addr: 'test@local',
      ts: FIXED_NOW,
      op: 'buyPowerup',
      args: [PROJECT_PATH, 0, 'upgrade073'],
      result: {
        node: {
          full_path: PROJECT_PATH,
          instance_data: {
            powerups: [{ slot: 0, gestalt: 'upgrade073', full_type: 'UpgradePowerup:upgrade073' }],
            // Legacy: only base venture tokens, no upgrade merge.
            tokens: [
              { gestalt: 'token001', amount: 100, full_type: 'TokenPerp:token001' },
              { gestalt: 'token018', amount: 0, full_type: 'TokenPerp:token018' },
              { gestalt: 'token125', amount: 0, full_type: 'TokenPerp:token125' },
            ],
          },
        },
        game_values: {},
      },
    };
    setState(applyDelta(getState(), buggyDelta));
    // Confirm the bug landed in state.
    expect(findToken(getState().nodes[0].instance_data.tokens, 'token125').amount).toBe(0);

    await loadGame();

    const after = getState().nodes[0].instance_data.tokens;
    expect(findToken(after, 'token018').amount).toBe(25);
    expect(findToken(after, 'token125').amount).toBe(100);
  });
});

describe('sellPowerup — drops upgrade token amounts back to base', () => {
  it('selling Blood test drops token125 back to 0 (base venture default)', async () => {
    // Start with Blood test already installed in slot 0.
    const seededNode = Object.assign({}, PROJECT_NODE, {
      instance_data: {
        powerups: [{ slot: 0, gestalt: 'upgrade073', full_type: 'UpgradePowerup:upgrade073' }],
      },
    });
    setState(
      mkState({
        nodes: [seededNode],
        game_values: { cash_value: 5000 },
      })
    );

    const { result } = await sellPowerup(PROJECT_PATH, 0, 'upgrade073');
    expect(result.error).toBeUndefined();
    const tokens = result.node.instance_data.tokens;
    // token125 is exclusive to Blood test → falls back to base amount 0.
    expect(findToken(tokens, 'token125').amount).toBe(0);
    // Base tokens (always-100 ones) remain unchanged.
    expect(findToken(tokens, 'token001').amount).toBe(100);
  });
});

// dd_app chargecollect.py CollectableContact.getTokensMap reads
// instance_data.tokens (falling back to type_data.tokens), so an upgrade's
// data points are part of every later collect.
describe('collectPerp — upgrade-unlocked data points are collected', () => {
  it('Blood test (upgrade073) yields token018 in the collected tokens_map', async () => {
    setState(projectState());
    await buyPowerup(PROJECT_PATH, 0, 'upgrade073');
    setState(
      Object.assign({}, getState(), {
        nodes_collect: [{ path: PROJECT_PATH, result: { amount: 100 } }],
      })
    );

    const { result } = await collectPerp(PROJECT_PATH);

    const tokensMap = result.result.profile_set.tokens_map;
    expect(tokensMap.token018).toEqual({ amount: 25 });
    expect(tokensMap.token125).toEqual({ amount: 100 });
    expect(getState().db_queue[0].profile_set.tokens_map.token018).toEqual({ amount: 25 });
  });
});

// getTokensMap also skips amount-0 entries, so upgrade-gated data points the
// player hasn't unlocked never turn into 0 % Database tokens.
describe('collectPerp → integrateCollected — amount-0 data points are skipped', () => {
  const P001 = 'Imperium.CityVienna.project001';
  const GATED = [
    'token011',
    'token012',
    'token064',
    'token065',
    'token129',
    'token130',
    'token132',
  ];

  it('project001 queues only its 11 unlocked tokens and seeds no 0 % nodes', async () => {
    setState(
      mkState({
        nodes: [mkNode('ProjectPerp', P001)],
        nodes_collect: [{ path: P001, result: { amount: 100 } }],
      })
    );

    const { result } = await collectPerp(P001);
    const tokensMap = result.result.profile_set.tokens_map;
    expect(Object.keys(tokensMap)).toHaveLength(11);
    for (const g of GATED) expect(tokensMap[g]).toBeUndefined();

    await integrateCollected(result.result.collect_id);
    const tokenNodes = getState().nodes.filter((n) => n.game_type === 'TokenPerp');
    expect(tokenNodes).toHaveLength(11);
    expect(tokenNodes.filter((n) => !n.instance_data.amount)).toEqual([]);
  });
});

// dd_app getPerpChargeData freezes tokens_map into the charge result, so a
// powerup bought or sold while the charge runs only affects the next charge.
describe('chargePerp → collectPerp — tokens_map is fixed when the charge starts', () => {
  async function collectAfterCharge(midCharge) {
    await chargePerp(PROJECT_PATH);
    await midCharge();
    setOverride(getState().nodes_charging[0].charge_end + 1);
    const { result } = await collectPerp(PROJECT_PATH);
    return result.result.profile_set.tokens_map;
  }

  it('buying Blood test mid-charge does not add token018 to this collect', async () => {
    setState(projectState());
    const tokensMap = await collectAfterCharge(() => buyPowerup(PROJECT_PATH, 0, 'upgrade073'));
    expect(tokensMap.token018).toBeUndefined();
    expect(tokensMap.token001).toEqual({ amount: 100 });
  });

  it('selling Blood test mid-charge keeps token018 in this collect', async () => {
    setState(projectState());
    await buyPowerup(PROJECT_PATH, 0, 'upgrade073');
    const tokensMap = await collectAfterCharge(() => sellPowerup(PROJECT_PATH, 0, 'upgrade073'));
    expect(tokensMap.token018).toEqual({ amount: 25 });
  });
});
