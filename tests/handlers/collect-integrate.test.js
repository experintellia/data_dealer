/**
 * Tests for collectPerp + integrateCollected handlers (issue #17).
 *
 * Schema for nodes_collect[i].result (written by chargePerp, consumed here):
 *   { amount: number } — Thread S chargePerp schema (PR #72).
 *   XP gain is derived from ruleset type_data.xp_inc, not stored in result.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  collectPerp, integrateCollected, chargePerp, buyPerp, buyPowerup, loadGame,
  setEmitter, setPrngSeed, setSendDelta
} from '../../scripts/LocalEngine.js';
import { setState, getState } from '../../scripts/boot.js';
import { materialize } from '../../scripts/materializer.js';
import { applyDelta } from '../../scripts/state.js';
import { setOverride, clearOverride, advance } from '../../scripts/clock.js';
import { FIXED_NOW, mkGv, mkState, mkNode, mkChargingEntry } from './_fixtures.js';

// ── Fixtures ─────────────────────────────────────────────────────────────────

const CHARGE_DUR = 120_000;                    // 2 min charge
const CHARGE_END = FIXED_NOW + CHARGE_DUR;

// ── Full flow: charge → advance clock → collect → integrate ──────────────────

describe('full flow: ContactPerp charge → collect → integrate', () => {
  const PATH = 'Imperium.City.Agent0.contact001';
  const COLLECT_RESULT = { amount: 5 };

  beforeEach(() => setOverride(FIXED_NOW));
  afterEach(() => { clearOverride(); setEmitter(null); });

  it('collect before charge_end returns error 1', async () => {
    setState(mkState({
      nodes:          [mkNode('ContactPerp', PATH)],
      nodes_charging: [mkChargingEntry(PATH, COLLECT_RESULT, 'ContactPerp')]
    }));

    const data = await collectPerp(PATH);
    expect(data.result.error).toBe(1);
  });

  it('collect after charge_end succeeds and puts entry in db_queue', async () => {
    setState(mkState({
      nodes:          [mkNode('ContactPerp', PATH)],
      nodes_charging: [mkChargingEntry(PATH, COLLECT_RESULT, 'ContactPerp')]
    }));

    // Advance past charge_end
    setOverride(CHARGE_END + 1000);

    const data = await collectPerp(PATH);
    expect(data.result.error).toBeUndefined();
    expect(data.result.result.profile_set.profiles_value).toBe(5);
    // contact001's `tokens` list populates tokens_map (percentage * profiles).
    expect(typeof data.result.result.profile_set.tokens_map).toBe('object');
    expect(data.result.result.origin).toBe(PATH);
    expect(typeof data.result.result.collect_id).toBe('string');
    expect(data.result.result.collect_id.length).toBeGreaterThan(0);
  });

  it('nodes_collect is cleared and db_queue gains one entry after collect', async () => {
    setState(mkState({
      nodes:          [mkNode('ContactPerp', PATH)],
      nodes_charging: [mkChargingEntry(PATH, COLLECT_RESULT, 'ContactPerp')]
    }));
    setOverride(CHARGE_END + 1000);

    const { result } = await collectPerp(PATH);
    const collectId = result.result.collect_id;

    // Now call loadGame to inspect persisted state
    const { getState } = await import('../../scripts/boot.js');
    const s = getState();
    expect(s.nodes_collect).toHaveLength(0);
    expect(s.db_queue).toHaveLength(1);
    expect(s.db_queue[0].collect_id).toBe(collectId);
  });

  it('integrateCollected resolves the db_queue entry', async () => {
    setState(mkState({
      nodes:          [mkNode('ContactPerp', PATH)],
      nodes_charging: [mkChargingEntry(PATH, COLLECT_RESULT, 'ContactPerp')]
    }));
    setOverride(CHARGE_END + 1000);

    const { result: colRes } = await collectPerp(PATH);
    const collectId = colRes.result.collect_id;

    const { result: intRes } = await integrateCollected(collectId);
    expect(intRes.result.increment).toBe(5);
    expect(intRes.result.dup).toBe(0);
    expect(Array.isArray(intRes.result.nodes)).toBe(true);
    expect(intRes.game_values.profiles_value).toBe(5);
  });

  it('re-integrating the same collect_id returns dup=profiles_value and increment=0', async () => {
    setState(mkState({
      nodes:          [mkNode('ContactPerp', PATH)],
      nodes_charging: [mkChargingEntry(PATH, COLLECT_RESULT, 'ContactPerp')]
    }));
    setOverride(CHARGE_END + 1000);

    const { result: colRes } = await collectPerp(PATH);
    const collectId = colRes.result.collect_id;

    // First integration.
    await integrateCollected(collectId);

    // Manually re-insert the db_queue entry to simulate a retry.
    const { getState: gs, setState: ss } = await import('../../scripts/boot.js');
    const cur = gs();
    ss(Object.assign({}, cur, {
      db_queue: [{ origin: PATH, collect_id: collectId, profile_set: { profiles_value: 5, tokens_map: {} }, collect_dt: FIXED_NOW }]
    }));

    const { result: intRes2 } = await integrateCollected(collectId);
    expect(intRes2.result.dup).toBe(5);
    expect(intRes2.result.increment).toBe(0);
  });

  it('xp_value is incremented by xp_gain after collect', async () => {
    setState(mkState({
      nodes:          [mkNode('ContactPerp', PATH)],
      nodes_charging: [mkChargingEntry(PATH, COLLECT_RESULT, 'ContactPerp')]
    }));
    setOverride(CHARGE_END + 1000);

    const { result } = await collectPerp(PATH);
    // base xp_value = 5, contact001 xp_inc = 1 → 6
    expect(result.game_values.xp_value).toBe(6);
  });

  it('integrateCollected errors with 0 for unknown collect_id', async () => {
    setState(mkState());
    const data = await integrateCollected('no-such-id');
    expect(data.result.error).toBe(0);
  });
});

// ── ContactPerp branch ───────────────────────────────────────────────────────

describe('collectPerp — ContactPerp', () => {
  const PATH = 'Imperium.City.Agent0.contact002';
  const PS = { profiles_value: 3, tokens_map: {} };

  beforeEach(() => setOverride(FIXED_NOW));
  afterEach(() => clearOverride());

  it('returns profile_set, origin, and collect_id in result.result', async () => {
    setState(mkState({
      nodes:         [mkNode('ContactPerp', PATH)],
      nodes_collect: [{ path: PATH, result: { amount: 3 } }]
    }));

    const { result } = await collectPerp(PATH);
    expect(result.result.profile_set).toEqual({ profiles_value: 3, tokens_map: {} });
    expect(result.result.origin).toBe(PATH);
    expect(typeof result.result.collect_id).toBe('string');
  });

  it('does not return cash or token_upgraded_amount', async () => {
    setState(mkState({
      nodes:         [mkNode('ContactPerp', PATH)],
      nodes_collect: [{ path: PATH, result: { amount: 3 } }]
    }));

    const { result } = await collectPerp(PATH);
    expect(result.result.cash).toBeUndefined();
    expect(result.result.token_upgraded_amount).toBeUndefined();
  });

  it('response carries game_values, levelup, and missions', async () => {
    setState(mkState({
      nodes:         [mkNode('ContactPerp', PATH)],
      nodes_collect: [{ path: PATH, result: { amount: 3 } }]
    }));

    const { result } = await collectPerp(PATH);
    expect(result.game_values).toBeDefined();
    expect(typeof result.levelup).toBe('boolean');
    expect(result.missions).toBeDefined();
  });
});

// ── ProjectPerp branch ───────────────────────────────────────────────────────

describe('collectPerp — ProjectPerp', () => {
  const PATH = 'Imperium.City.project001';

  beforeEach(() => setOverride(FIXED_NOW));
  afterEach(() => clearOverride());

  it('returns profile_set, origin, and collect_id', async () => {
    setState(mkState({
      nodes:         [mkNode('ProjectPerp', PATH)],
      nodes_collect: [{ path: PATH, result: { amount: 10 } }]
    }));

    const { result } = await collectPerp(PATH);
    expect(result.result.profile_set.profiles_value).toBe(10);
    expect(typeof result.result.profile_set.tokens_map).toBe('object');
    expect(result.result.origin).toBe(PATH);
    expect(result.result.collect_id).toBeTruthy();
  });

  it('pushes to db_queue with correct shape', async () => {
    setState(mkState({
      nodes:         [mkNode('ProjectPerp', PATH)],
      nodes_collect: [{ path: PATH, result: { amount: 10 } }]
    }));

    const { result } = await collectPerp(PATH);
    const { getState } = await import('../../scripts/boot.js');
    const s = getState();
    expect(s.db_queue).toHaveLength(1);
    const q = s.db_queue[0];
    expect(q.collect_id).toBe(result.result.collect_id);
    expect(q.profile_set.profiles_value).toBe(10);
    expect(typeof q.profile_set.tokens_map).toBe('object');
    expect(q.origin).toBe(PATH);
    expect(typeof q.collect_dt).toBe('number');
  });
});

// ── ClientPerp branch ────────────────────────────────────────────────────────

describe('collectPerp — ClientPerp', () => {
  const PATH = 'Imperium.City.Pusher0.client001';

  beforeEach(() => setOverride(FIXED_NOW));
  afterEach(() => clearOverride());

  it('returns cash (new cash_value) in result.result', async () => {
    setState(mkState({
      nodes:         [mkNode('ClientPerp', PATH)],
      nodes_collect: [{ path: PATH, result: { amount: 100 } }],
      game_values:   mkGv({ cash_value: 300 })
    }));

    const { result } = await collectPerp(PATH);
    expect(result.result.cash).toBe(400);
    expect(result.game_values.cash_value).toBe(400);
  });

  it('does not return profile_set or token_upgraded_amount', async () => {
    setState(mkState({
      nodes:         [mkNode('ClientPerp', PATH)],
      nodes_collect: [{ path: PATH, result: { amount: 50 } }]
    }));

    const { result } = await collectPerp(PATH);
    expect(result.result.profile_set).toBeUndefined();
    expect(result.result.token_upgraded_amount).toBeUndefined();
  });

  it('does not push to db_queue', async () => {
    setState(mkState({
      nodes:         [mkNode('ClientPerp', PATH)],
      nodes_collect: [{ path: PATH, result: { amount: 50 } }]
    }));

    await collectPerp(PATH);
    const { getState } = await import('../../scripts/boot.js');
    expect(getState().db_queue).toHaveLength(0);
  });
});

// ── TokenPerp branch ─────────────────────────────────────────────────────────

describe('collectPerp — TokenPerp', () => {
  const PATH = 'Imperium.Database.token001';

  beforeEach(() => setOverride(FIXED_NOW));
  afterEach(() => clearOverride());

  it('returns token_upgraded_amount (prevAmount + amount_gain)', async () => {
    setState(mkState({
      nodes:         [mkNode('TokenPerp', PATH, { amount: 3 })],
      nodes_collect: [{ path: PATH, result: { amount: 2 } }]
    }));

    const { result } = await collectPerp(PATH);
    expect(result.result.token_upgraded_amount).toBe(5);
  });

  it('updates instance_data.amount in state.nodes', async () => {
    setState(mkState({
      nodes:         [mkNode('TokenPerp', PATH, { amount: 3 })],
      nodes_collect: [{ path: PATH, result: { amount: 2 } }]
    }));

    await collectPerp(PATH);
    const { getState } = await import('../../scripts/boot.js');
    const node = getState().nodes.find(n => n.full_path === PATH);
    expect(node.instance_data.amount).toBe(5);
  });

  it('does not return profile_set or cash', async () => {
    setState(mkState({
      nodes:         [mkNode('TokenPerp', PATH, { amount: 0 })],
      nodes_collect: [{ path: PATH, result: { amount: 4 } }]
    }));

    const { result } = await collectPerp(PATH);
    expect(result.result.profile_set).toBeUndefined();
    expect(result.result.cash).toBeUndefined();
  });
});

// ── Failure paths ────────────────────────────────────────────────────────────

describe('collectPerp — failure paths', () => {
  beforeEach(() => setOverride(FIXED_NOW));
  afterEach(() => clearOverride());

  it('error 1 when path is not in nodes_collect', async () => {
    setState(mkState({ nodes: [mkNode('ContactPerp', 'Imperium.City.contact001')] }));
    const data = await collectPerp('Imperium.City.contact001');
    expect(data.result.error).toBe(1);
  });

  it('error 1 when charge_end is still in the future (materializer leaves it in nodes_charging)', async () => {
    const PATH = 'Imperium.City.contact_early';
    setState(mkState({
      nodes:          [mkNode('ContactPerp', PATH)],
      // charge_end is 10 min from FIXED_NOW
      nodes_charging: [Object.assign(mkChargingEntry(PATH, { amount: 1 }, 'ContactPerp'),
                       { charge_end: FIXED_NOW + 600_000 })]
    }));

    const data = await collectPerp(PATH);
    expect(data.result.error).toBe(1);
  });

  it('error 2 when path is in nodes_collect but node not in nodes array', async () => {
    const PATH = 'Imperium.City.ghost001';
    setState(mkState({
      nodes:         [],   // no matching node
      nodes_collect: [{ path: PATH, result: { amount: 0 } }]
    }));
    const data = await collectPerp(PATH);
    expect(data.result.error).toBe(2);
  });
});

// ── karma_incident with fixed PRNG seed ─────────────────────────────────────

describe('collectPerp — karma_incident', () => {
  const PATH = 'Imperium.City.Pusher0.client_karma';

  beforeEach(() => setOverride(FIXED_NOW));
  afterEach(() => { clearOverride(); setPrngSeed(0xDEADBEEF); });

  it('karma_incident absent when karma_value >= 0', async () => {
    setState(mkState({
      nodes:         [mkNode('ClientPerp', PATH)],
      nodes_collect: [{ path: PATH, result: { amount: 50 } }],
      game_values:   mkGv({ karma_value: 50, xp_level: 5 })
    }));
    setPrngSeed(42);
    const { result } = await collectPerp(PATH);
    expect(result.karma_incident).toBeUndefined();
  });

  it('seeded PRNG fires karma_incident and returns expected karmalizer gestalt', async () => {
    // karma=-80 → factor≈0.944; seed=42 first RNG value≈0.601 → fires
    // eligible at level=5: 4 karmalizers; seed=42 second RNG value picks karma014
    setState(mkState({
      nodes:         [mkNode('ClientPerp', PATH)],
      nodes_collect: [{ path: PATH, result: { amount: 50 } }],
      game_values:   mkGv({ karma_value: -80, xp_level: 5 })
    }));
    setPrngSeed(42);

    const { result } = await collectPerp(PATH);
    expect(result.karma_incident).toBe('karma014');
  });

  it('karma_incident decreases karma_value within [-100, 100]', async () => {
    setState(mkState({
      nodes:         [mkNode('ClientPerp', PATH)],
      nodes_collect: [{ path: PATH, result: { amount: 50 } }],
      game_values:   mkGv({ karma_value: -80, xp_level: 5 })
    }));
    setPrngSeed(42);

    const { result } = await collectPerp(PATH);
    expect(result.game_values.karma_value).toBeLessThan(-80);
    expect(result.game_values.karma_value).toBeGreaterThanOrEqual(-100);
  });

  it('karma_incident absent when no eligible karmalizers (level 1)', async () => {
    // All karmalizers have required_level >= 5, so none eligible at level 1.
    setState(mkState({
      nodes:         [mkNode('ClientPerp', PATH)],
      nodes_collect: [{ path: PATH, result: { amount: 50 } }],
      game_values:   mkGv({ karma_value: -80, xp_level: 1 })
    }));
    setPrngSeed(42);

    const { result } = await collectPerp(PATH);
    // No eligible karmalizers → incident null → karma_incident absent.
    expect(result.karma_incident).toBeUndefined();
  });
});

// ── integrateCollected with token nodes ──────────────────────────────────────

describe('integrateCollected — token node updates', () => {
  const TOKEN_PATH = 'Imperium.Database.token_a';
  const COLLECT_ID = 'test-collect-001';

  beforeEach(() => setOverride(FIXED_NOW));
  afterEach(() => clearOverride());

  it('merges instance_data.amount as a weighted-average share', async () => {
    // Upstream dd_app/dd_calc.py Database.merge:
    //   new_share = min(100, (db_share * M + ps_share * N) / (M + N))
    // M = profiles_value before merge (here 6), N = ps.profiles_value (4),
    // db_share = 2, ps_share = 3 → (2*6 + 3*4)/(6+4) = 24/10 = 2.4.
    const tokenNode = mkNode('TokenPerp', TOKEN_PATH, { amount: 2 });
    tokenNode.gestalt = 'token_a';
    setState(mkState({
      game_values: mkGv({ profiles_value: 6 }),
      nodes: [tokenNode],
      db_queue: [{
        origin:      'Imperium.City.contact001',
        collect_id:  COLLECT_ID,
        profile_set: { profiles_value: 4, tokens_map: { token_a: { amount: 3 } }, xp_gain: 1, karma_gain: 0 },
        collect_dt:  FIXED_NOW
      }]
    }));

    const { result } = await integrateCollected(COLLECT_ID);
    expect(result.result.nodes).toHaveLength(1);
    expect(result.result.nodes[0].instance_data.amount).toBeCloseTo(2.4, 6);
    expect(result.result.increment).toBe(4);
    expect(result.result.dup).toBe(0);
    expect(result.game_values.profiles_value).toBe(10);
  });

  it('clamps instance_data.amount at 100 — bar width = amount/100*60px must not overflow', async () => {
    // Construct a state where the weighted average overshoots 100 so the
    // upstream `min(100, …)` clamp is exercised. db_share=99, M=10,
    // ps_share=200 (hypothetical bad ruleset row), N=10 → (99*10 + 200*10)/20
    // = 149.5, clamped to 100.
    const tokenNode = mkNode('TokenPerp', TOKEN_PATH, { amount: 99 });
    tokenNode.gestalt = 'token_a';
    setState(mkState({
      game_values: mkGv({ profiles_value: 10 }),
      nodes: [tokenNode],
      db_queue: [{
        origin:      'Imperium.City.contact001',
        collect_id:  COLLECT_ID,
        profile_set: { profiles_value: 10, tokens_map: { token_a: { amount: 200 } } },
        collect_dt:  FIXED_NOW
      }]
    }));

    const { result } = await integrateCollected(COLLECT_ID);
    expect(result.result.nodes[0].instance_data.amount).toBe(100);
  });

  it('clamps a fresh-seeded TokenPerp at 100 too', async () => {
    // Seed share = ps_share * N / (M + N). With M=0 this collapses to ps_share,
    // so an over-100 ruleset row still hits the clamp at seed time.
    setState(mkState({
      locale: 'en',
      db_queue: [{
        origin:      'Imperium.City.contact001',
        collect_id:  COLLECT_ID,
        profile_set: { profiles_value: 50, tokens_map: { token008: { amount: 250 } } },
        collect_dt:  FIXED_NOW
      }]
    }));

    const { result } = await integrateCollected(COLLECT_ID);
    const seeded = result.result.nodes.find(n => n.gestalt === 'token008');
    expect(seeded.instance_data.amount).toBe(100);
  });

  it('dilutes a TokenPerp not present in the new profileset', async () => {
    // The whole point of the upstream merge: tokens that the new profileset
    // does *not* contribute to should be diluted as the DB grows. This is
    // what makes the per-tile bar (and the status-bar crosssum) move down,
    // not just up. db_share=80, M=10, no ps_share, N=10 → 80*10/(10+10) = 40.
    // Absolute count is preserved: M*old/100 = 8 == (M+N)*new/100.
    const tokenA = mkNode('TokenPerp', 'Imperium.Database.token_a', { amount: 80 });
    tokenA.gestalt = 'token_a';
    setState(mkState({
      game_values: mkGv({ profiles_value: 10 }),
      nodes: [tokenA],
      db_queue: [{
        origin:      'Imperium.City.contact001',
        collect_id:  COLLECT_ID,
        profile_set: { profiles_value: 10, tokens_map: { token_b: { amount: 100 } } },
        collect_dt:  FIXED_NOW
      }]
    }));

    const { result } = await integrateCollected(COLLECT_ID);
    const updatedA = result.result.nodes.find(n => n.gestalt === 'token_a');
    expect(updatedA).toBeDefined();
    expect(updatedA.instance_data.amount).toBeCloseTo(40, 6);
    // Absolute count of token_a profiles must not regress.
    const absBefore = (10 * 80) / 100;
    const absAfter  = ((10 + 10) * updatedA.instance_data.amount) / 100;
    expect(absAfter).toBeCloseTo(absBefore, 6);
  });

  it('does not change shares on a duplicate collect_id replay (N = 0)', async () => {
    const tokenNode = mkNode('TokenPerp', TOKEN_PATH, { amount: 40 });
    tokenNode.gestalt = 'token_a';
    setState(mkState({
      game_values:    mkGv({ profiles_value: 10 }),
      integrated_ids: { [COLLECT_ID]: true },
      nodes: [tokenNode],
      db_queue: [{
        origin:      'Imperium.City.contact001',
        collect_id:  COLLECT_ID,
        profile_set: { profiles_value: 10, tokens_map: { token_a: { amount: 100 } } },
        collect_dt:  FIXED_NOW
      }]
    }));

    const { result } = await integrateCollected(COLLECT_ID);
    expect(result.result.dup).toBe(10);
    expect(result.result.increment).toBe(0);
    // Share is unchanged because N (= increment) is 0; M+N = M, db share kept.
    expect(result.result.nodes ?? []).toHaveLength(0);
  });

  it('returns game_values, levelup, and missions for server parity', async () => {
    setState(mkState({
      db_queue: [{
        origin:      'Imperium.City.contact001',
        collect_id:  COLLECT_ID,
        profile_set: { profiles_value: 1, tokens_map: {} },
        collect_dt:  FIXED_NOW
      }]
    }));

    const { result } = await integrateCollected(COLLECT_ID);
    expect(result.game_values).toBeDefined();
    expect(typeof result.levelup).toBe('boolean');
    expect(result.missions).toBeDefined();
  });

  it('drains db_queue after successful integration', async () => {
    setState(mkState({
      db_queue: [{
        origin:      'Imperium.City.contact001',
        collect_id:  COLLECT_ID,
        profile_set: { profiles_value: 2, tokens_map: {} },
        collect_dt:  FIXED_NOW
      }]
    }));

    await integrateCollected(COLLECT_ID);
    const { getState } = await import('../../scripts/boot.js');
    expect(getState().db_queue).toHaveLength(0);
  });

  it('appends a new TokenPerp node the first time a token type is integrated', async () => {
    // token008 is a real ruleset entry (mission002 targets it). State has no
    // node for it yet — integrateCollected must seed one under Database/.
    setState(mkState({
      locale: 'en',
      db_queue: [{
        origin:      'Imperium.City.contact001',
        collect_id:  COLLECT_ID,
        profile_set: { profiles_value: 50, tokens_map: { token008: { amount: 25 } } },
        collect_dt:  FIXED_NOW
      }]
    }));

    const { result } = await integrateCollected(COLLECT_ID);
    const newEntry = result.result.nodes.find(function (n) { return n.gestalt === 'token008'; });
    expect(newEntry).toBeDefined();
    expect(newEntry.game_type).toBe('TokenPerp');
    expect(newEntry.full_path).toBe('Database.token008');
    expect(newEntry.instance_data.amount).toBe(25);

    const { getState } = await import('../../scripts/boot.js');
    const persisted = getState().nodes.find(function (n) { return n.gestalt === 'token008'; });
    expect(persisted).toBeDefined();
    expect(persisted.full_path).toBe('Database.token008');
  });

  it('does not seed a node for a gestalt that is not in ruleset.tokens', async () => {
    setState(mkState({
      locale: 'en',
      db_queue: [{
        origin:      'Imperium.City.contact001',
        collect_id:  COLLECT_ID,
        profile_set: { profiles_value: 5, tokens_map: { not_a_real_token: { amount: 9 } } },
        collect_dt:  FIXED_NOW
      }]
    }));

    const { result } = await integrateCollected(COLLECT_ID);
    expect(result.result.nodes).toHaveLength(0);
  });
});

// ── level-up refills AP across collect/integrate paths ──────────────────────
//
// Level 1 (de + en): xp_min=0,  xp_max=10, ap_max=6
// Level 2 (de + en): xp_min=11, xp_max=30, ap_max=8

describe('collectPerp — level-up refills ap_snapshot to the new ap_max', () => {
  const PATH = 'Imperium.City.Agent0.contact001';

  beforeEach(() => setOverride(FIXED_NOW));
  afterEach(() => { clearOverride(); setEmitter(null); });

  it('crossing the xp_max threshold returns levelup=true and ap_snapshot=8', async () => {
    setState(mkState({
      // xp_value=10 + xp_inc=1 (contact001) = 11 → level 2.
      game_values: Object.assign({}, mkGv(), {
        xp_value: 10, xp_level: 1, ap_snapshot: 0, ap_max: 6
      }),
      nodes: [{
        game_id: 'node_contact001', game_type: 'ContactPerp',
        full_type: 'ContactPerp:contact001', gestalt: 'contact001',
        full_path: PATH, instance_data: {}
      }],
      nodes_collect: [{ path: PATH, result: { amount: 5 } }]
    }));

    const { result } = await collectPerp(PATH);
    expect(result.levelup).toBe(true);
    expect(result.game_values.xp_level).toBe(2);
    expect(result.game_values.ap_snapshot).toBe(8);
  });
});

describe('integrateCollected — ap cost', () => {
  const COLLECT_ID = 'ap-cost-001';

  beforeEach(() => setOverride(FIXED_NOW));
  afterEach(() => { clearOverride(); setEmitter(null); });

  it('decrements ap_snapshot by 1', async () => {
    setState(mkState({
      game_values: Object.assign({}, mkGv(), { ap_snapshot: 5, ap_max: 6 }),
      db_queue: [{
        origin:      'Imperium.City.contact001',
        collect_id:  COLLECT_ID,
        profile_set: { profiles_value: 1, tokens_map: {} },
        collect_dt:  FIXED_NOW
      }]
    }));

    const { result } = await integrateCollected(COLLECT_ID);
    expect(result.game_values.ap_snapshot).toBe(4);
  });

  it('returns error 1 when ap_snapshot is 0 (parity with chargePerp)', async () => {
    setState(mkState({
      game_values: Object.assign({}, mkGv(), { ap_snapshot: 0, ap_max: 6 }),
      db_queue: [{
        origin:      'Imperium.City.contact001',
        collect_id:  COLLECT_ID,
        profile_set: { profiles_value: 1, tokens_map: {} },
        collect_dt:  FIXED_NOW
      }]
    }));

    const data = await integrateCollected(COLLECT_ID);
    expect(data.result.error).toBe(1);
  });

  it('level-up refill overrides the AP cost — full ap_max after crossing threshold', async () => {
    setState(mkState({
      game_values: Object.assign({}, mkGv(), {
        xp_value: 10, xp_level: 1, ap_snapshot: 3, ap_max: 6
      }),
      db_queue: [{
        origin:      'Imperium.City.contact001',
        collect_id:  COLLECT_ID,
        profile_set: { profiles_value: 1, tokens_map: {}, xp_gain: 10 },
        collect_dt:  FIXED_NOW
      }]
    }));

    const { result } = await integrateCollected(COLLECT_ID);
    expect(result.levelup).toBe(true);
    expect(result.game_values.xp_level).toBe(2);
    expect(result.game_values.ap_snapshot).toBe(8); // level 2 ap_max, not 3-1=2
  });
});

describe('integrateCollected — level-up refills ap_snapshot to the new ap_max', () => {
  const COLLECT_ID = 'lvlup-integrate-001';

  beforeEach(() => setOverride(FIXED_NOW));
  afterEach(() => { clearOverride(); setEmitter(null); });

  it('crossing xp_max via xp_gain returns levelup=true and full AP', async () => {
    setState(mkState({
      game_values: Object.assign({}, mkGv(), {
        xp_value: 5, xp_level: 1, ap_snapshot: 1, ap_max: 6
      }),
      db_queue: [{
        origin: 'Imperium.City.contact001',
        collect_id: COLLECT_ID,
        // xp_gain on the profile_set drives xp gain on integrate.
        profile_set: { profiles_value: 4, tokens_map: {}, xp_gain: 10, karma_gain: 0 },
        collect_dt: FIXED_NOW
      }]
    }));

    const { result } = await integrateCollected(COLLECT_ID);
    expect(result.levelup).toBe(true);
    expect(result.game_values.xp_level).toBe(2);
    expect(result.game_values.ap_snapshot).toBe(8);
  });
});

// ── tokens_map populated from typeData.tokens ──────────────────────────────
//
// Contacts list yielded token types under `tokens`; each entry's `amount`
// is a percentage of profiles_value. Without a populated tokens_map,
// integrate_profiles missions can't advance.

describe('collectPerp — tokens_map population from typeData.tokens', () => {
  // contact001 (Nurse Helen) has 12 tokens, each at 100%.
  const PATH = 'Imperium.City.Agent0.contact001';

  beforeEach(() => setOverride(FIXED_NOW));
  afterEach(() => { clearOverride(); setEmitter(null); });

  it('tokens_map carries an entry for every gestalt in typeData.tokens', async () => {
    setState(mkState({
      nodes:         [mkNode('ContactPerp', PATH)],
      nodes_collect: [{ path: PATH, result: { amount: 10 } }]
    }));

    const { result } = await collectPerp(PATH);
    const tm = result.result.profile_set.tokens_map;
    // contact001 lists token001, token002, ..., token018, origin012 — 12 in total.
    expect(Object.keys(tm).sort()).toEqual([
      'origin012',
      'token001', 'token002', 'token003', 'token004', 'token005',
      'token006', 'token007', 'token014', 'token015', 'token017',
      'token018'
    ].sort());
  });

  it('amount is the raw ruleset percentage (passed through unchanged)', async () => {
    setState(mkState({
      nodes:         [mkNode('ContactPerp', PATH)],
      nodes_collect: [{ path: PATH, result: { amount: 10 } }]
    }));

    const { result } = await collectPerp(PATH);
    expect(result.result.profile_set.tokens_map.token001).toEqual({ amount: 100 });
    expect(result.result.profile_set.tokens_map.token008).toBeUndefined(); // not in contact001's list
  });

  it('Jessica (contact035) yields token008 from her tokens list — unblocks mission002', async () => {
    const JPATH = 'Imperium.CityVienna.Agent0.contact035';
    setState(mkState({
      nodes:         [mkNode('ContactPerp', JPATH)],
      nodes_collect: [{ path: JPATH, result: { amount: 1100 } }]
    }));

    const { result } = await collectPerp(JPATH);
    // Jessica lists token008 at 100%; downstream absoluteAmount =
    // profiles_value * amount / 100 = 1100, which exceeds mission002's 900 target.
    expect(result.result.profile_set.tokens_map.token008).toEqual({ amount: 100 });
  });

  it('tokens_map stays empty when typeData.tokens is missing', async () => {
    // contact002 is not in the ruleset → typeData undefined → tokens_map empty.
    const FPATH = 'Imperium.City.Agent0.contact002';
    setState(mkState({
      nodes:         [mkNode('ContactPerp', FPATH)],
      nodes_collect: [{ path: FPATH, result: { amount: 5 } }]
    }));

    const { result } = await collectPerp(FPATH);
    expect(result.result.profile_set.tokens_map).toEqual({});
  });
});

// ── integrateCollected payload shape ────────────────────────────────────────
//
// Newly seeded TokenPerp nodes must carry game_type and full_type so the
// applyDelta reducer can append them on cold-start replay.

describe('integrateCollected — payload shape for newly seeded TokenPerps', () => {
  const COLLECT_ID = 'shape-001';

  beforeEach(() => setOverride(FIXED_NOW));
  afterEach(() => { clearOverride(); setEmitter(null); });

  it('new node entries carry game_type=TokenPerp and full_type=TokenPerp:<gestalt>', async () => {
    setState(mkState({
      locale: 'en',
      db_queue: [{
        origin:      'Imperium.City.contact001',
        collect_id:  COLLECT_ID,
        profile_set: { profiles_value: 50, tokens_map: { token008: { amount: 25 } } },
        collect_dt:  FIXED_NOW
      }]
    }));

    const { result } = await integrateCollected(COLLECT_ID);
    const newEntry = result.result.nodes.find(function (n) { return n.gestalt === 'token008'; });
    expect(newEntry).toBeDefined();
    expect(newEntry.game_type).toBe('TokenPerp');
    expect(newEntry.full_type).toBe('TokenPerp:token008');
    expect(newEntry.full_path).toBe('Database.token008');
    expect(newEntry.game_id).toBe('token008');
  });

  it('seeded entries replay correctly through applyDelta', async () => {
    setState(mkState({
      locale: 'en',
      db_queue: [{
        origin:      'Imperium.City.contact001',
        collect_id:  COLLECT_ID,
        profile_set: { profiles_value: 50, tokens_map: { token008: { amount: 25 } } },
        collect_dt:  FIXED_NOW
      }]
    }));

    await integrateCollected(COLLECT_ID);
    const { getState } = await import('../../scripts/boot.js');
    const persisted = getState().nodes.find(function (n) { return n.gestalt === 'token008'; });
    expect(persisted.game_type).toBe('TokenPerp');
    expect(persisted.full_type).toBe('TokenPerp:token008');
  });
});

// ── Mission progression: collect_profiles + integrate_profiles ──────────────

describe('mission progression — integrate_profiles flow', () => {
  const JESSICA = 'Imperium.City.Agent0.contact035';
  const COLLECT_ID = 'mission-progress-001';

  beforeEach(() => setOverride(FIXED_NOW));
  afterEach(() => { clearOverride(); setEmitter(null); });

  function seedMission002Active() {
    setState(mkState({
      active_missions: ['mission002'],
      mission_goals: [{
        mission: 'mission002',
        workflow: 'integrate_profiles',
        target: 'token008',
        amount: 900,
        position: 1,
        current_amount: 0,
        complete: false
      }],
      db_queue: [{
        origin:      JESSICA,
        collect_id:  COLLECT_ID,
        profile_set: { profiles_value: 1100, tokens_map: { token008: { amount: 100 } } },
        collect_dt:  FIXED_NOW
      }]
    }));
  }

  it('integrating Jessica advances mission002.current_amount to the absoluteAmount', async () => {
    seedMission002Active();
    const { result } = await integrateCollected(COLLECT_ID);
    const goal = getState().mission_goals.find(g => g.mission === 'mission002');
    // profiles_value=1100, amount=100% → absolute=1100, capped at goal.amount=900.
    expect(goal.current_amount).toBe(900);
    expect(goal.complete).toBe(true);
    // Response carries the same shape Game.js consumes.
    expect(result.missions.complete_missions).toContain('mission002');
  });

  it('partial integrate (50% coverage) advances current_amount but stays incomplete', async () => {
    setState(mkState({
      active_missions: ['mission002'],
      mission_goals: [{
        mission: 'mission002',
        workflow: 'integrate_profiles',
        target: 'token008',
        amount: 900,
        position: 1,
        current_amount: 0,
        complete: false
      }],
      db_queue: [{
        origin:      JESSICA,
        collect_id:  COLLECT_ID,
        profile_set: { profiles_value: 1000, tokens_map: { token008: { amount: 50 } } },
        collect_dt:  FIXED_NOW
      }]
    }));

    await integrateCollected(COLLECT_ID);
    const goal = getState().mission_goals.find(g => g.mission === 'mission002');
    // profiles_value=1000, amount=50% → absolute=500.
    expect(goal.current_amount).toBe(500);
    expect(goal.complete).toBe(false);
  });

  it('completing mission002 activates mission003 (required_mission chain) with seeded goals', async () => {
    seedMission002Active();
    await integrateCollected(COLLECT_ID);
    const s = getState();
    expect(s.active_missions).not.toContain('mission002');
    expect(s.active_missions).toContain('mission003');
    const m3goal = s.mission_goals.find(g => g.mission === 'mission003');
    expect(m3goal).toBeDefined();
    expect(m3goal.current_amount).toBe(0);
    expect(m3goal.complete).toBe(false);
  });

  it('mission_goals delta replays cleanly through applyDelta', async () => {
    seedMission002Active();
    await integrateCollected(COLLECT_ID);
    // Cold-start replay: take the persisted state, run loadGame.
    const s1 = getState();
    setState(s1);
    await loadGame();
    const goal = getState().mission_goals.find(g => g.mission === 'mission002');
    expect(goal.current_amount).toBe(900);
    expect(goal.complete).toBe(true);
  });

  it('progress is monotonic — a smaller integrate does not roll back current_amount', async () => {
    // First integrate fills mission002 to 900 (Jessica 100% × 1100 profiles).
    seedMission002Active();
    await integrateCollected(COLLECT_ID);

    // Construct a hypothetical second integrate from a 50%-coverage contact
    // that, naively, would compute a smaller absoluteAmount. Using
    // _advanceIntegrateProfilesMissions directly via state setup: feed a
    // db_queue entry whose profile_set has lower amount on token008, then
    // assert mission002.current_amount stays at the high-water mark.
    const s = getState();
    s.mission_goals = s.mission_goals.map(g =>
      g.mission === 'mission002'
        ? Object.assign({}, g, { current_amount: 500, complete: false })
        : g
    );
    s.active_missions = s.active_missions.concat(['mission002']);
    s.db_queue = [{
      origin: JESSICA, collect_id: 'second-integrate',
      profile_set: { profiles_value: 100, tokens_map: { token008: { amount: 50 } } },
      collect_dt: FIXED_NOW
    }];
    setState(s);

    await integrateCollected('second-integrate');
    // 100 profiles × 50% = 50 absolute → would regress from 500 if not guarded.
    const goal = getState().mission_goals.find(g => g.mission === 'mission002');
    expect(goal.current_amount).toBeGreaterThanOrEqual(500);
  });
});

describe('mission progression — collect_profiles flow', () => {
  const JESSICA = 'Imperium.City.Agent0.contact035';

  beforeEach(() => setOverride(FIXED_NOW));
  afterEach(() => { clearOverride(); setEmitter(null); });

  it('collecting Jessica advances mission001.current_amount by the collected profile count', async () => {
    setState(mkState({
      nodes: [mkNode('ContactPerp', JESSICA)],
      nodes_collect: [{ path: JESSICA, result: { amount: 600 } }],
      active_missions: ['mission001'],
      mission_goals: [{
        mission: 'mission001',
        workflow: 'collect_profiles',
        target: 'contact035',
        amount: 900,
        position: 2,
        current_amount: 0,
        complete: false
      }]
    }));

    await collectPerp(JESSICA);
    const goal = getState().mission_goals.find(g => g.mission === 'mission001');
    expect(goal.current_amount).toBe(600);
    expect(goal.complete).toBe(false);
  });

  it('two collects from Jessica complete mission001 (cumulative)', async () => {
    setState(mkState({
      nodes: [mkNode('ContactPerp', JESSICA)],
      nodes_collect: [{ path: JESSICA, result: { amount: 600 } }],
      active_missions: ['mission001'],
      mission_goals: [{
        mission: 'mission001',
        workflow: 'collect_profiles',
        target: 'contact035',
        amount: 900,
        position: 2,
        current_amount: 0,
        complete: false
      }]
    }));

    await collectPerp(JESSICA);
    setState(Object.assign({}, getState(), {
      nodes_collect: [{ path: JESSICA, result: { amount: 600 } }]
    }));
    const { result } = await collectPerp(JESSICA);

    const goal = getState().mission_goals.find(g => g.mission === 'mission001');
    expect(goal.current_amount).toBe(900);
    expect(goal.complete).toBe(true);
    expect(result.missions.complete_missions).toContain('mission001');
  });

  it('collecting from a non-target contact does not advance mission001', async () => {
    const HELEN = 'Imperium.City.Agent1.contact001';
    setState(mkState({
      nodes: [mkNode('ContactPerp', HELEN)],
      nodes_collect: [{ path: HELEN, result: { amount: 1500 } }],
      active_missions: ['mission001'],
      mission_goals: [{
        mission: 'mission001',
        workflow: 'collect_profiles',
        target: 'contact035',
        amount: 900,
        position: 2,
        current_amount: 0,
        complete: false
      }]
    }));

    await collectPerp(HELEN);
    const goal = getState().mission_goals.find(g => g.mission === 'mission001');
    expect(goal.current_amount).toBe(0);
    expect(goal.complete).toBe(false);
  });
});

describe('loadGame seeds mission_goals from active_missions', () => {
  beforeEach(() => setOverride(FIXED_NOW));
  afterEach(() => { clearOverride(); setEmitter(null); });

  it('fresh game with mission001 active gets goals seeded from ruleset on first loadGame', async () => {
    setState(mkState({
      active_missions: ['mission001'],
      mission_goals: []
    }));

    await loadGame();

    const goals = getState().mission_goals;
    const m1 = goals.find(g => g.mission === 'mission001');
    expect(m1).toBeDefined();
    expect(m1.workflow).toBe('collect_profiles');
    expect(m1.target).toBe('contact035');
    expect(m1.amount).toBe(900);
    expect(m1.current_amount).toBe(0);
    expect(m1.complete).toBe(false);
  });

  it('idempotent — re-running loadGame does not duplicate goals', async () => {
    setState(mkState({
      active_missions: ['mission001'],
      mission_goals: []
    }));

    await loadGame();
    const goalsAfterFirst = getState().mission_goals.length;
    await loadGame();
    expect(getState().mission_goals.length).toBe(goalsAfterFirst);
  });
});

// ── Cash invariants & mission rewards ───────────────────────────────────────

describe('cash invariants — collect/integrate must not deduct cash', () => {
  const PATH = 'Imperium.City.Agent0.contact001';

  beforeEach(() => setOverride(FIXED_NOW));
  afterEach(() => { clearOverride(); setEmitter(null); });

  it('ContactPerp collect leaves cash_value unchanged', async () => {
    const startCash = 270;
    setState(mkState({
      game_values: Object.assign({}, mkGv(), { cash_value: startCash }),
      nodes: [mkNode('ContactPerp', PATH)],
      nodes_collect: [{ path: PATH, result: { amount: 5 } }]
    }));

    const { result } = await collectPerp(PATH);
    expect(result.game_values.cash_value).toBe(startCash);
    expect(getState().game_values.cash_value).toBe(startCash);
  });

  it('integrateCollected leaves cash_value unchanged when no rewards fire', async () => {
    const startCash = 270;
    setState(mkState({
      game_values: Object.assign({}, mkGv(), { cash_value: startCash }),
      db_queue: [{
        origin: PATH, collect_id: 'no-rewards',
        profile_set: { profiles_value: 1, tokens_map: {} },
        collect_dt: FIXED_NOW
      }]
    }));

    const { result } = await integrateCollected('no-rewards');
    expect(result.game_values.cash_value).toBe(startCash);
  });
});

describe('mission rewards — apply on completion', () => {
  const JESSICA = 'Imperium.City.Agent0.contact035';
  const COLLECT_ID = 'rewards-001';

  beforeEach(() => setOverride(FIXED_NOW));
  afterEach(() => { clearOverride(); setEmitter(null); });

  it('completing mission002 grants its 100 cash + 1 xp reward', async () => {
    const startCash = 200;
    const startXp = 0;
    setState(mkState({
      game_values: Object.assign({}, mkGv(), {
        cash_value: startCash, xp_value: startXp
      }),
      active_missions: ['mission002'],
      mission_goals: [{
        mission: 'mission002',
        workflow: 'integrate_profiles',
        target: 'token008',
        amount: 900,
        position: 1,
        current_amount: 0,
        complete: false
      }],
      db_queue: [{
        origin: JESSICA, collect_id: COLLECT_ID,
        profile_set: { profiles_value: 1100, tokens_map: { token008: { amount: 100 } } },
        collect_dt: FIXED_NOW
      }]
    }));

    const { result } = await integrateCollected(COLLECT_ID);
    expect(result.game_values.cash_value).toBe(startCash + 100);
    expect(result.game_values.xp_value).toBeGreaterThanOrEqual(startXp + 1);
  });

  it('partial-progress integrate (no completion) yields no rewards', async () => {
    const startCash = 200;
    setState(mkState({
      game_values: Object.assign({}, mkGv(), { cash_value: startCash }),
      active_missions: ['mission002'],
      mission_goals: [{
        mission: 'mission002',
        workflow: 'integrate_profiles',
        target: 'token008',
        amount: 900,
        position: 1,
        current_amount: 0,
        complete: false
      }],
      db_queue: [{
        origin: JESSICA, collect_id: COLLECT_ID,
        profile_set: { profiles_value: 500, tokens_map: { token008: { amount: 50 } } },
        collect_dt: FIXED_NOW
      }]
    }));

    const { result } = await integrateCollected(COLLECT_ID);
    expect(result.game_values.cash_value).toBe(startCash);
  });

  it('end-to-end: charge car company → wait → collect adds ~584 cash', async () => {
    const CAR_PATH = 'Imperium.City.Pusher0.client007';
    setState(mkState({
      game_values: Object.assign({}, mkGv(), {
        cash_value: 100, ap_snapshot: 6, xp_level: 1
      }),
      nodes: [{
        game_id: 'client007', game_type: 'ClientPerp',
        full_type: 'ClientPerp:client007', gestalt: 'client007',
        full_path: CAR_PATH,
        instance_data: {}
      }]
    }));

    const chargeRes = await chargePerp(CAR_PATH);
    expect(chargeRes.result.error).toBeUndefined();
    expect(chargeRes.result.duration).toBe(60000); // car charge_time
    const cashAfterCharge = getState().game_values.cash_value;
    expect(cashAfterCharge).toBe(100); // car has no charge_cost

    // Move clock past charge_end and materialize so the entry transitions.
    setOverride(FIXED_NOW + 60001);
    const matResult = materialize(getState(), FIXED_NOW + 60001);
    setState(matResult.state);
    expect(getState().nodes_collect).toHaveLength(1);
    expect(getState().nodes_collect[0].path).toBe(CAR_PATH);

    const collectRes = await collectPerp(CAR_PATH);
    expect(collectRes.result.error).toBeUndefined();
    const finalCash = collectRes.result.game_values.cash_value;
    // 584 ± 5% variation, rounded.
    expect(finalCash - cashAfterCharge).toBeGreaterThanOrEqual(553);
    expect(finalCash - cashAfterCharge).toBeLessThanOrEqual(614);
    expect(getState().game_values.cash_value).toBe(finalCash);
  });

  it('completing mission001 grants its xp reward via collectPerp', async () => {
    const startXp = 0;
    setState(mkState({
      game_values: Object.assign({}, mkGv(), { xp_value: startXp }),
      nodes: [mkNode('ContactPerp', JESSICA)],
      nodes_collect: [{ path: JESSICA, result: { amount: 1100 } }],
      active_missions: ['mission001'],
      mission_goals: [{
        mission: 'mission001',
        workflow: 'collect_profiles',
        target: 'contact035',
        amount: 900,
        position: 2,
        current_amount: 0,
        complete: false
      }]
    }));

    const { result } = await collectPerp(JESSICA);
    // contact035 xp_inc=1 + mission001 reward=2.
    expect(result.game_values.xp_value).toBe(startXp + 1 + 2);
  });
});

// ── Per-mission integration tests: missions 003–016 ──────────────────────────
//
// Covers all new workflow helpers added in #97:
//   _advanceChargePerpMissions   (charge_perp goals)
//   _advanceCollectCashMissions  (collect_cash goals)
//   _advanceBuyPowerupMissions   (buy_powerup goals)
//   _advanceUpgradeTokenMissions (upgrade_token goals)
//
// Each block seeds active_missions + mission_goals, calls the relevant
// handler(s), and asserts: goal progress · completion · reward · chain.

// IDs for the hash-named missions (title in parentheses).
var M_CASH_IN  = 'a388da08d87dc9fd6d543977a2047262000'; // Cash in!
var M_DB_MACH  = 'e59302bed28769c3c76761c14516e764000'; // Database machine
var M_PSYCHO   = 'e33a3ef9d70038e0a9c6d088f37d02cb000'; // Psycho
var M_COUCH    = 'af1149c315321ef4f477893fcc1807e1000'; // Couch Potato
var M_EMPLOYEE = 'b638f35b5ec6b0558981378c9037c3d3000'; // Employee Monitoring
var M_IMAGE    = '9f5735d01587f640cc862e0a82280d3f000'; // Improve your image
var M_COLLAB   = '16f302f84b84498a734dfdbe1a7794b9000'; // Unofficial collaboration
var M_ALFONSO  = 'dc481d7863ceb18575c50d36e2c5ecfe000'; // Alfonso

// High-level game_values: enough cash/level/AP for all purchases in tests.
function mkHighGv(overrides) {
  return mkGv(Object.assign({ xp_level: 10, cash_value: 100000, ap_snapshot: 6 }, overrides || {}));
}

function mkProjectNode(gestalt, path) {
  return { game_id: gestalt, game_type: 'ProjectPerp', full_type: 'ProjectPerp:' + gestalt,
    gestalt: gestalt, full_path: path, instance_data: {} };
}
function mkClientNode2(gestalt, path) {
  return { game_id: gestalt, game_type: 'ClientPerp', full_type: 'ClientPerp:' + gestalt,
    gestalt: gestalt, full_path: path, instance_data: {} };
}
function mkContactNode(gestalt, path) {
  return { game_id: gestalt, game_type: 'ContactPerp', full_type: 'ContactPerp:' + gestalt,
    gestalt: gestalt, full_path: path, instance_data: {} };
}
function mkTokenNode2(gestalt, path, amount) {
  return { game_id: gestalt, game_type: 'TokenPerp', full_type: 'TokenPerp:' + gestalt,
    gestalt: gestalt, full_path: path, instance_data: { amount: amount || 0 } };
}

// ── mission003 — Rookie Dealer ───────────────────────────────────────────────
// charge_perp(client007, amount:null)

describe('mission progression — mission003 Rookie Dealer (charge_perp)', () => {
  const C007 = 'Imperium.City.Pusher0.client007';

  beforeEach(() => setOverride(FIXED_NOW));
  afterEach(() => { clearOverride(); setEmitter(null); });

  it('charging client007 completes goal, grants +600 cash reward, activates mission004', async () => {
    setState(mkState({
      game_values: mkHighGv(),
      nodes: [mkClientNode2('client007', C007)],
      active_missions: ['mission003'],
      mission_goals: [{
        mission: 'mission003', workflow: 'charge_perp', target: 'client007',
        amount: null, position: 1, current_amount: 0, complete: false
      }]
    }));
    const startCash = getState().game_values.cash_value;

    const { result } = await chargePerp(C007);
    expect(result.error).toBeUndefined();

    const s = getState();
    const goal = s.mission_goals.find(g => g.mission === 'mission003');
    expect(goal.complete).toBe(true);
    expect(s.active_missions).not.toContain('mission003');
    expect(s.active_missions).toContain('mission004');
    // client007 charge_cost=0; mission003 reward = +600 cash
    expect(s.game_values.cash_value).toBe(startCash + 600);
    expect(s.mission_goals.filter(g => g.mission === 'mission004')).toHaveLength(2);
  });
});

// ── mission004 — You're a winner! ────────────────────────────────────────────
// buy_perp(project001, null) + charge_perp(project001, null)

describe("mission progression — mission004 You're a winner! (buy_perp + charge_perp)", () => {
  const P001 = 'Imperium.project001';

  beforeEach(() => setOverride(FIXED_NOW));
  afterEach(() => { clearOverride(); setEmitter(null); });

  function seedM004() {
    setState(mkState({
      game_values: mkHighGv({ xp_level: 2 }),
      nodes: [],
      active_missions: ['mission004'],
      mission_goals: [
        { mission: 'mission004', workflow: 'buy_perp', target: 'project001',
          amount: null, position: 1, current_amount: 0, complete: false },
        { mission: 'mission004', workflow: 'charge_perp', target: 'project001',
          amount: null, position: 2, current_amount: 0, complete: false }
      ]
    }));
  }

  it('buying project001 marks the buy_perp goal complete; mission stays active', async () => {
    seedM004();
    await buyPerp('Imperium', 'project001');
    const goals = getState().mission_goals.filter(g => g.mission === 'mission004');
    expect(goals.find(g => g.workflow === 'buy_perp').complete).toBe(true);
    expect(goals.find(g => g.workflow === 'charge_perp').complete).toBe(false);
    expect(getState().active_missions).toContain('mission004');
  });

  it('charging project001 after buying it completes mission004 and activates M_CASH_IN', async () => {
    seedM004();
    await buyPerp('Imperium', 'project001');
    const { result } = await chargePerp(P001);
    expect(result.error).toBeUndefined();

    const s = getState();
    expect(s.active_missions).not.toContain('mission004');
    expect(s.active_missions).toContain(M_CASH_IN);
    expect(result.missions.complete_missions).toContain('mission004');
  });
});

// ── M_CASH_IN — Cash in! ─────────────────────────────────────────────────────
// collect_cash(client007, 500)

describe('mission progression — M_CASH_IN Cash in! (collect_cash)', () => {
  const C007 = 'Imperium.City.Pusher0.client007';

  beforeEach(() => setOverride(FIXED_NOW));
  afterEach(() => { clearOverride(); setEmitter(null); });

  it('collecting 200 cash advances goal to 200 without completing mission', async () => {
    setState(mkState({
      game_values: mkHighGv({ cash_value: 0 }),
      nodes: [mkClientNode2('client007', C007)],
      nodes_collect: [{ path: C007, result: { amount: 200 } }],
      active_missions: [M_CASH_IN],
      mission_goals: [{
        mission: M_CASH_IN, workflow: 'collect_cash', target: 'client007',
        amount: 500, position: 1, current_amount: 0, complete: false
      }]
    }));

    await collectPerp(C007);
    const goal = getState().mission_goals.find(g => g.mission === M_CASH_IN);
    expect(goal.current_amount).toBe(200);
    expect(goal.complete).toBe(false);
    expect(getState().active_missions).toContain(M_CASH_IN);
  });

  it('collecting 600 fills the 500 goal, grants +200 cash reward, activates mission006', async () => {
    setState(mkState({
      game_values: mkHighGv({ cash_value: 0 }),
      nodes: [mkClientNode2('client007', C007)],
      nodes_collect: [{ path: C007, result: { amount: 600 } }],
      active_missions: [M_CASH_IN],
      mission_goals: [{
        mission: M_CASH_IN, workflow: 'collect_cash', target: 'client007',
        amount: 500, position: 1, current_amount: 0, complete: false
      }]
    }));

    const { result } = await collectPerp(C007);
    const s = getState();
    const goal = s.mission_goals.find(g => g.mission === M_CASH_IN);
    expect(goal.current_amount).toBe(500); // capped at goal.amount
    expect(goal.complete).toBe(true);
    expect(s.active_missions).not.toContain(M_CASH_IN);
    expect(s.active_missions).toContain('mission006');
    // start=0 + collect=600 + reward=200 = 800
    expect(s.game_values.cash_value).toBe(800);
    expect(result.missions.complete_missions).toContain(M_CASH_IN);
  });
});

// ── mission006 — Upgrade raffle ───────────────────────────────────────────────
// buy_powerup(upgrade001 on project001) + buy_powerup(ad002) + buy_powerup(teammember020)

describe('mission progression — mission006 Upgrade raffle (buy_powerup x3)', () => {
  const P001 = 'Imperium.City.project001';

  beforeEach(() => setOverride(FIXED_NOW));
  afterEach(() => { clearOverride(); setEmitter(null); });

  it('buying upgrade001 marks goal 1 complete; mission still active', async () => {
    setState(mkState({
      game_values: mkHighGv({ xp_level: 2 }),
      nodes: [mkProjectNode('project001', P001)],
      active_missions: ['mission006'],
      mission_goals: [
        { mission: 'mission006', workflow: 'buy_powerup', target: 'upgrade001',
          amount: null, position: 1, current_amount: 0, complete: false },
        { mission: 'mission006', workflow: 'buy_powerup', target: 'ad002',
          amount: null, position: 2, current_amount: 0, complete: false },
        { mission: 'mission006', workflow: 'buy_powerup', target: 'teammember020',
          amount: null, position: 3, current_amount: 0, complete: false }
      ]
    }));
    await buyPowerup(P001, 0, 'upgrade001');
    const goals = getState().mission_goals.filter(g => g.mission === 'mission006');
    expect(goals.find(g => g.target === 'upgrade001').complete).toBe(true);
    expect(goals.find(g => g.target === 'ad002').complete).toBe(false);
    expect(getState().active_missions).toContain('mission006');
  });

  it('buying all three powerups completes mission006, grants reward, activates mission007', async () => {
    setState(mkState({
      game_values: mkHighGv({ xp_level: 2 }),
      nodes: [mkProjectNode('project001', P001)],
      active_missions: ['mission006'],
      mission_goals: [
        { mission: 'mission006', workflow: 'buy_powerup', target: 'upgrade001',
          amount: null, position: 1, current_amount: 0, complete: false },
        { mission: 'mission006', workflow: 'buy_powerup', target: 'ad002',
          amount: null, position: 2, current_amount: 0, complete: false },
        { mission: 'mission006', workflow: 'buy_powerup', target: 'teammember020',
          amount: null, position: 3, current_amount: 0, complete: false }
      ]
    }));

    await buyPowerup(P001, 0, 'upgrade001');
    await buyPowerup(P001, 1, 'ad002');
    const { result } = await buyPowerup(P001, 2, 'teammember020');

    const s = getState();
    expect(s.mission_goals.filter(g => g.mission === 'mission006').every(g => g.complete)).toBe(true);
    expect(s.active_missions).not.toContain('mission006');
    expect(s.active_missions).toContain('mission007');
    expect(result.missions.complete_missions).toContain('mission006');
  });
});

// ── mission007 — Nurse Helen ──────────────────────────────────────────────────
// buy_perp(contact001, null) + collect_profiles(contact001, 3000) + integrate_profiles(token017, 3000)

describe('mission progression — mission007 Nurse Helen (buy+collect+integrate)', () => {
  const CT1 = 'Imperium.contact001';

  beforeEach(() => setOverride(FIXED_NOW));
  afterEach(() => { clearOverride(); setEmitter(null); });

  function seedM007() {
    setState(mkState({
      game_values: mkHighGv({ xp_level: 3 }),
      nodes: [],
      active_missions: ['mission007'],
      mission_goals: [
        { mission: 'mission007', workflow: 'buy_perp', target: 'contact001',
          amount: null, position: 1, current_amount: 0, complete: false },
        { mission: 'mission007', workflow: 'collect_profiles', target: 'contact001',
          amount: 3000, position: 2, current_amount: 0, complete: false },
        { mission: 'mission007', workflow: 'integrate_profiles', target: 'token017',
          amount: 3000, position: 3, current_amount: 0, complete: false }
      ]
    }));
  }

  it('buying contact001 marks buy_perp goal complete; mission stays active', async () => {
    seedM007();
    await buyPerp('Imperium', 'contact001');
    const goal = getState().mission_goals.find(
      g => g.mission === 'mission007' && g.workflow === 'buy_perp');
    expect(goal.complete).toBe(true);
    expect(getState().active_missions).toContain('mission007');
  });

  it('full 3-step flow completes mission007 and activates M_DB_MACH', async () => {
    seedM007();
    await buyPerp('Imperium', 'contact001');

    // Seed collect entry for the node buyPerp just created.
    const s1 = getState();
    setState(Object.assign({}, s1, {
      nodes_collect: [{ path: CT1, result: { amount: 3000 } }]
    }));

    const { result: colRes } = await collectPerp(CT1);
    const collectId = colRes.result.collect_id;

    const { result: intRes } = await integrateCollected(collectId);

    const s = getState();
    expect(s.mission_goals.filter(g => g.mission === 'mission007').every(g => g.complete)).toBe(true);
    expect(s.active_missions).not.toContain('mission007');
    expect(s.active_missions).toContain(M_DB_MACH);
    expect(intRes.missions.complete_missions).toContain('mission007');
  });
});

// ── M_DB_MACH — Database machine ─────────────────────────────────────────────
// upgrade_token(token007, null)

describe('mission progression — M_DB_MACH Database machine (upgrade_token)', () => {
  const T007 = 'Database.token007';

  beforeEach(() => setOverride(FIXED_NOW));
  afterEach(() => { clearOverride(); setEmitter(null); });

  it('collecting from token007 completes upgrade_token goal and activates mission008', async () => {
    setState(mkState({
      game_values: mkHighGv(),
      nodes: [mkTokenNode2('token007', T007, 0)],
      nodes_collect: [{ path: T007, result: { amount: 0 } }],
      active_missions: [M_DB_MACH],
      mission_goals: [{
        mission: M_DB_MACH, workflow: 'upgrade_token', target: 'token007',
        amount: null, position: 1, current_amount: 0, complete: false
      }]
    }));

    const { result } = await collectPerp(T007);
    expect(result.error).toBeUndefined();

    const s = getState();
    const goal = s.mission_goals.find(g => g.mission === M_DB_MACH);
    expect(goal.complete).toBe(true);
    expect(s.active_missions).not.toContain(M_DB_MACH);
    expect(s.active_missions).toContain('mission008');
    expect(result.missions.complete_missions).toContain(M_DB_MACH);
  });
});

// ── mission008 — Sick World ───────────────────────────────────────────────────
// buy_perp(client002, null) + charge_perp(client002, null) + buy_perp(contact019, null)

describe('mission progression — mission008 Sick World (buy+charge+buy)', () => {
  const C2 = 'Imperium.client002';

  beforeEach(() => setOverride(FIXED_NOW));
  afterEach(() => { clearOverride(); setEmitter(null); });

  function seedM008() {
    setState(mkState({
      game_values: mkHighGv({ xp_level: 4 }),
      nodes: [],
      active_missions: ['mission008'],
      mission_goals: [
        { mission: 'mission008', workflow: 'buy_perp', target: 'client002',
          amount: null, position: 1, current_amount: 0, complete: false },
        { mission: 'mission008', workflow: 'charge_perp', target: 'client002',
          amount: null, position: 2, current_amount: 0, complete: false },
        { mission: 'mission008', workflow: 'buy_perp', target: 'contact019',
          amount: null, position: 3, current_amount: 0, complete: false }
      ]
    }));
  }

  it('buying client002 then charging then buying contact019 completes mission008 + activates mission005', async () => {
    seedM008();
    await buyPerp('Imperium', 'client002');
    await chargePerp(C2);
    const { result } = await buyPerp('Imperium', 'contact019');

    const s = getState();
    expect(s.mission_goals.filter(g => g.mission === 'mission008').every(g => g.complete)).toBe(true);
    expect(s.active_missions).not.toContain('mission008');
    expect(s.active_missions).toContain('mission005');
    expect(result.missions.complete_missions).toContain('mission008');
  });
});

// ── mission005 — So green! ────────────────────────────────────────────────────
// integrate_profiles(token084, 10000) + collect_cash(client007, 500)

describe('mission progression — mission005 So green! (integrate_profiles + collect_cash)', () => {
  const C007 = 'Imperium.City.Pusher0.client007';
  const COLL_ID = 'so-green-001';

  beforeEach(() => setOverride(FIXED_NOW));
  afterEach(() => { clearOverride(); setEmitter(null); });

  function seedM005(extraGoalFields) {
    setState(mkState({
      game_values: mkHighGv({ cash_value: 0 }),
      nodes: [mkClientNode2('client007', C007)],
      active_missions: ['mission005'],
      mission_goals: [
        Object.assign({ mission: 'mission005', workflow: 'integrate_profiles', target: 'token084',
          amount: 10000, position: 1, current_amount: 0, complete: false }, extraGoalFields || {}),
        { mission: 'mission005', workflow: 'collect_cash', target: 'client007',
          amount: 500, position: 2, current_amount: 0, complete: false }
      ]
    }));
  }

  it('integrating 10000 profiles at 100% token084 fills integrate_profiles goal', async () => {
    setState(mkState({
      game_values: mkHighGv({ cash_value: 0 }),
      nodes: [mkClientNode2('client007', C007)],
      active_missions: ['mission005'],
      mission_goals: [
        { mission: 'mission005', workflow: 'integrate_profiles', target: 'token084',
          amount: 10000, position: 1, current_amount: 0, complete: false },
        { mission: 'mission005', workflow: 'collect_cash', target: 'client007',
          amount: 500, position: 2, current_amount: 0, complete: false }
      ],
      db_queue: [{
        origin: 'Imperium.City.contact001',
        collect_id: COLL_ID,
        profile_set: { profiles_value: 10000, tokens_map: { token084: { amount: 100 } } },
        collect_dt: FIXED_NOW
      }]
    }));

    await integrateCollected(COLL_ID);
    const goal = getState().mission_goals.find(
      g => g.mission === 'mission005' && g.workflow === 'integrate_profiles');
    expect(goal.current_amount).toBe(10000);
    expect(goal.complete).toBe(true);
    expect(getState().active_missions).toContain('mission005'); // cash goal still pending
  });

  it('collect_cash + integrate both complete → mission005 done, grants reward, activates M_PSYCHO', async () => {
    setState(mkState({
      game_values: mkHighGv({ cash_value: 0 }),
      nodes: [mkClientNode2('client007', C007)],
      nodes_collect: [{ path: C007, result: { amount: 600 } }],
      active_missions: ['mission005'],
      mission_goals: [
        { mission: 'mission005', workflow: 'integrate_profiles', target: 'token084',
          amount: 10000, position: 1, current_amount: 10000, complete: true },
        { mission: 'mission005', workflow: 'collect_cash', target: 'client007',
          amount: 500, position: 2, current_amount: 0, complete: false }
      ]
    }));

    const { result } = await collectPerp(C007);
    const s = getState();
    expect(s.mission_goals.filter(g => g.mission === 'mission005').every(g => g.complete)).toBe(true);
    expect(s.active_missions).not.toContain('mission005');
    expect(s.active_missions).toContain(M_PSYCHO);
    // start=0 + collect=600 + reward=1000 = 1600
    expect(s.game_values.cash_value).toBe(1600);
    expect(result.missions.complete_missions).toContain('mission005');
  });
});

// ── M_PSYCHO — Psycho ─────────────────────────────────────────────────────────
// buy_perp(project003) + buy_powerup(upgrade015 on project003) + charge_perp(project003)

describe('mission progression — M_PSYCHO Psycho (buy_perp + buy_powerup + charge_perp)', () => {
  const P3 = 'Imperium.project003';

  beforeEach(() => setOverride(FIXED_NOW));
  afterEach(() => { clearOverride(); setEmitter(null); });

  it('all three goals complete → M_PSYCHO done, activates M_COUCH', async () => {
    setState(mkState({
      game_values: mkHighGv({ xp_level: 5 }),
      nodes: [],
      active_missions: [M_PSYCHO],
      mission_goals: [
        { mission: M_PSYCHO, workflow: 'buy_perp', target: 'project003',
          amount: null, position: 1, current_amount: 0, complete: false },
        { mission: M_PSYCHO, workflow: 'buy_powerup', target: 'upgrade015',
          amount: null, position: 2, current_amount: 0, complete: false },
        { mission: M_PSYCHO, workflow: 'charge_perp', target: 'project003',
          amount: null, position: 3, current_amount: 0, complete: false }
      ]
    }));

    await buyPerp('Imperium', 'project003');
    await buyPowerup(P3, 0, 'upgrade015');
    const { result } = await chargePerp(P3);
    expect(result.error).toBeUndefined();

    const s = getState();
    expect(s.mission_goals.filter(g => g.mission === M_PSYCHO).every(g => g.complete)).toBe(true);
    expect(s.active_missions).not.toContain(M_PSYCHO);
    expect(s.active_missions).toContain(M_COUCH);
    expect(result.missions.complete_missions).toContain(M_PSYCHO);
  });
});

// ── M_COUCH — Couch Potato ────────────────────────────────────────────────────
// collect_profiles(contact019, 6000) + integrate_profiles(token088, 6000) + collect_cash(client002, 500)

describe('mission progression — M_COUCH Couch Potato (collect+integrate+cash)', () => {
  const CT19 = 'Imperium.contact019';
  const C2   = 'Imperium.City.Pusher0.client002';
  const COLL_ID = 'couch-001';

  beforeEach(() => setOverride(FIXED_NOW));
  afterEach(() => { clearOverride(); setEmitter(null); });

  it('all three goals complete → M_COUCH done, activates M_EMPLOYEE', async () => {
    setState(mkState({
      game_values: mkHighGv({ cash_value: 0 }),
      nodes: [
        mkContactNode('contact019', CT19),
        mkClientNode2('client002', C2)
      ],
      nodes_collect: [
        { path: CT19, result: { amount: 6000 } },
        { path: C2,   result: { amount: 600  } }
      ],
      active_missions: [M_COUCH],
      mission_goals: [
        { mission: M_COUCH, workflow: 'collect_profiles', target: 'contact019',
          amount: 6000, position: 1, current_amount: 0, complete: false },
        { mission: M_COUCH, workflow: 'integrate_profiles', target: 'token088',
          amount: 6000, position: 2, current_amount: 0, complete: false },
        { mission: M_COUCH, workflow: 'collect_cash', target: 'client002',
          amount: 500, position: 3, current_amount: 0, complete: false }
      ]
    }));

    // Step 1: collect from contact019 — fills collect_profiles goal.
    const { result: c19Res } = await collectPerp(CT19);
    const collectId = c19Res.result.collect_id;
    const goal1 = getState().mission_goals.find(
      g => g.mission === M_COUCH && g.workflow === 'collect_profiles');
    expect(goal1.current_amount).toBe(6000);
    expect(goal1.complete).toBe(true);

    // Step 2: integrate — fills integrate_profiles goal via token088 in tokens_map.
    await integrateCollected(collectId);
    const goal2 = getState().mission_goals.find(
      g => g.mission === M_COUCH && g.workflow === 'integrate_profiles');
    expect(goal2.complete).toBe(true);

    // Step 3: collect cash from client002.
    const { result } = await collectPerp(C2);
    const s = getState();
    expect(s.mission_goals.filter(g => g.mission === M_COUCH).every(g => g.complete)).toBe(true);
    expect(s.active_missions).not.toContain(M_COUCH);
    expect(s.active_missions).toContain(M_EMPLOYEE);
    expect(result.missions.complete_missions).toContain(M_COUCH);
  });
});

// ── M_EMPLOYEE — Employee Monitoring ─────────────────────────────────────────
// buy_perp(client006) + collect_cash(client006, 2000)

describe('mission progression — M_EMPLOYEE Employee Monitoring (buy_perp + collect_cash)', () => {
  const C6 = 'Imperium.client006';

  beforeEach(() => setOverride(FIXED_NOW));
  afterEach(() => { clearOverride(); setEmitter(null); });

  it('buying client006 then collecting 2000+ cash completes M_EMPLOYEE, activates M_IMAGE', async () => {
    setState(mkState({
      game_values: mkHighGv(),
      nodes: [],
      active_missions: [M_EMPLOYEE],
      mission_goals: [
        { mission: M_EMPLOYEE, workflow: 'buy_perp', target: 'client006',
          amount: null, position: 1, current_amount: 0, complete: false },
        { mission: M_EMPLOYEE, workflow: 'collect_cash', target: 'client006',
          amount: 2000, position: 2, current_amount: 0, complete: false }
      ]
    }));

    await buyPerp('Imperium', 'client006');
    // Seed collect entry for the newly created node.
    const s1 = getState();
    setState(Object.assign({}, s1, {
      nodes_collect: [{ path: C6, result: { amount: 2500 } }]
    }));

    const { result } = await collectPerp(C6);
    const s = getState();
    const goals = s.mission_goals.filter(g => g.mission === M_EMPLOYEE);
    expect(goals.every(g => g.complete)).toBe(true);
    expect(s.active_missions).not.toContain(M_EMPLOYEE);
    expect(s.active_missions).toContain(M_IMAGE);
    expect(result.missions.complete_missions).toContain(M_EMPLOYEE);
  });
});

// ── M_IMAGE — Improve your image ─────────────────────────────────────────────
// buy_powerup(teammember043 on project003) + buy_powerup(ad006 on project003)

describe('mission progression — M_IMAGE Improve your image (buy_powerup x2)', () => {
  const P3 = 'Imperium.City.project003';

  beforeEach(() => setOverride(FIXED_NOW));
  afterEach(() => { clearOverride(); setEmitter(null); });

  it('buying teammember043 then ad006 on project003 completes M_IMAGE, activates M_COLLAB', async () => {
    setState(mkState({
      game_values: mkHighGv({ xp_level: 5 }),
      nodes: [mkProjectNode('project003', P3)],
      active_missions: [M_IMAGE],
      mission_goals: [
        { mission: M_IMAGE, workflow: 'buy_powerup', target: 'teammember043',
          amount: null, position: 1, current_amount: 0, complete: false },
        { mission: M_IMAGE, workflow: 'buy_powerup', target: 'ad006',
          amount: null, position: 2, current_amount: 0, complete: false }
      ]
    }));

    await buyPowerup(P3, 0, 'teammember043');
    const { result } = await buyPowerup(P3, 1, 'ad006');

    const s = getState();
    expect(s.mission_goals.filter(g => g.mission === M_IMAGE).every(g => g.complete)).toBe(true);
    expect(s.active_missions).not.toContain(M_IMAGE);
    expect(s.active_missions).toContain(M_COLLAB);
    expect(result.missions.complete_missions).toContain(M_IMAGE);
  });
});

// ── M_COLLAB — Unofficial collaboration ──────────────────────────────────────
// buy_perp(agent004) + buy_perp(contact026)

describe('mission progression — M_COLLAB Unofficial collaboration (buy_perp x2)', () => {
  beforeEach(() => setOverride(FIXED_NOW));
  afterEach(() => { clearOverride(); setEmitter(null); });

  it('buying agent004 then contact026 completes M_COLLAB, activates M_ALFONSO', async () => {
    setState(mkState({
      game_values: mkHighGv({ xp_level: 7 }),
      nodes: [],
      active_missions: [M_COLLAB],
      mission_goals: [
        { mission: M_COLLAB, workflow: 'buy_perp', target: 'agent004',
          amount: null, position: 1, current_amount: 0, complete: false },
        { mission: M_COLLAB, workflow: 'buy_perp', target: 'contact026',
          amount: null, position: 2, current_amount: 0, complete: false }
      ]
    }));

    await buyPerp('Imperium', 'agent004');
    const { result } = await buyPerp('Imperium', 'contact026');

    const s = getState();
    expect(s.mission_goals.filter(g => g.mission === M_COLLAB).every(g => g.complete)).toBe(true);
    expect(s.active_missions).not.toContain(M_COLLAB);
    expect(s.active_missions).toContain(M_ALFONSO);
    expect(result.missions.complete_missions).toContain(M_COLLAB);
  });
});

// ── M_ALFONSO — Alfonso ───────────────────────────────────────────────────────
// buy_perp(pusher003)

describe('mission progression — M_ALFONSO Alfonso (buy_perp)', () => {
  beforeEach(() => setOverride(FIXED_NOW));
  afterEach(() => { clearOverride(); setEmitter(null); });

  it('buying pusher003 completes M_ALFONSO, grants reward, activates 3cb94923... chain', async () => {
    const M_BOGUS = '3cb9492322191121ebf7a10aafd0fc4a000';
    setState(mkState({
      game_values: mkHighGv(),
      nodes: [],
      active_missions: [M_ALFONSO],
      mission_goals: [{
        mission: M_ALFONSO, workflow: 'buy_perp', target: 'pusher003',
        amount: null, position: 1, current_amount: 0, complete: false
      }]
    }));

    const { result } = await buyPerp('Imperium', 'pusher003');
    const s = getState();
    expect(s.mission_goals.find(g => g.mission === M_ALFONSO).complete).toBe(true);
    expect(s.active_missions).not.toContain(M_ALFONSO);
    expect(s.active_missions).toContain(M_BOGUS);
    expect(result.missions.complete_missions).toContain(M_ALFONSO);
  });
});

// ── M_BOGUS — Bogus company tangle ───────────────────────────────────────────
// buy_perp(proxy004)

describe('mission progression — M_BOGUS Bogus company tangle (buy_perp)', () => {
  var M_BOGUS = '3cb9492322191121ebf7a10aafd0fc4a000';
  var M_MULT  = '1da63b8adf60878f693dfb9d9f73690f000';

  beforeEach(() => setOverride(FIXED_NOW));
  afterEach(() => { clearOverride(); setEmitter(null); });

  it('buying proxy004 completes M_BOGUS and activates M_MULT (Multiplication 101)', async () => {
    setState(mkState({
      game_values: mkHighGv({ xp_level: 9 }),
      nodes: [],
      active_missions: [M_BOGUS],
      mission_goals: [{
        mission: M_BOGUS, workflow: 'buy_perp', target: 'proxy004',
        amount: null, position: 1, current_amount: 0, complete: false
      }]
    }));

    const { result } = await buyPerp('Imperium', 'proxy004');
    const s = getState();
    expect(s.mission_goals.find(g => g.mission === M_BOGUS).complete).toBe(true);
    expect(s.active_missions).not.toContain(M_BOGUS);
    expect(s.active_missions).toContain(M_MULT);
    expect(result.missions.complete_missions).toContain(M_BOGUS);
  });
});

// ── M_MULT — Multiplication 101 ───────────────────────────────────────────────
// buy_perp(token055) + upgrade_token(token055)

describe('mission progression — M_MULT Multiplication 101 (buy_perp + upgrade_token)', () => {
  var M_MULT   = '1da63b8adf60878f693dfb9d9f73690f000';
  var M_BIGAPPLE = '2f59d10a67ca7ee9006dfe5db31a4c5f000';
  const T055 = 'Imperium.token055';

  beforeEach(() => setOverride(FIXED_NOW));
  afterEach(() => { clearOverride(); setEmitter(null); });

  function seedMMult() {
    setState(mkState({
      game_values: mkHighGv({ xp_level: 7 }),
      nodes: [],
      active_missions: [M_MULT],
      mission_goals: [
        { mission: M_MULT, workflow: 'buy_perp', target: 'token055',
          amount: null, position: 1, current_amount: 0, complete: false },
        { mission: M_MULT, workflow: 'upgrade_token', target: 'token055',
          amount: null, position: 2, current_amount: 0, complete: false }
      ]
    }));
  }

  it('buying token055 marks buy_perp goal complete; mission stays active', async () => {
    seedMMult();
    await buyPerp('Imperium', 'token055');
    const goal = getState().mission_goals.find(
      g => g.mission === M_MULT && g.workflow === 'buy_perp');
    expect(goal.complete).toBe(true);
    expect(getState().active_missions).toContain(M_MULT);
  });

  it('collecting from token055 after buying it completes M_MULT and activates M_BIGAPPLE', async () => {
    seedMMult();
    await buyPerp('Imperium', 'token055');

    // Seed collect entry for the TokenPerp node buyPerp created.
    const s1 = getState();
    setState(Object.assign({}, s1, {
      nodes_collect: [{ path: T055, result: { amount: 0 } }]
    }));

    const { result } = await collectPerp(T055);
    const s = getState();
    expect(s.mission_goals.filter(g => g.mission === M_MULT).every(g => g.complete)).toBe(true);
    expect(s.active_missions).not.toContain(M_MULT);
    expect(s.active_missions).toContain(M_BIGAPPLE);
    expect(result.missions.complete_missions).toContain(M_MULT);
  });
});

// ── M_BIGAPPLE — Big Apple, Big Data! ────────────────────────────────────────
// buy_perp(city004)  — final mission in the trunk chain

describe('mission progression — M_BIGAPPLE Big Apple, Big Data! (buy_perp)', () => {
  var M_BIGAPPLE = '2f59d10a67ca7ee9006dfe5db31a4c5f000';

  beforeEach(() => setOverride(FIXED_NOW));
  afterEach(() => { clearOverride(); setEmitter(null); });

  it('buying city004 completes M_BIGAPPLE (last mission — no chain follow-up)', async () => {
    setState(mkState({
      game_values: mkHighGv({ xp_level: 11 }),
      nodes: [],
      active_missions: [M_BIGAPPLE],
      mission_goals: [{
        mission: M_BIGAPPLE, workflow: 'buy_perp', target: 'city004',
        amount: null, position: 1, current_amount: 0, complete: false
      }]
    }));

    const { result } = await buyPerp('Imperium', 'city004');
    const s = getState();
    expect(s.mission_goals.find(g => g.mission === M_BIGAPPLE).complete).toBe(true);
    expect(s.active_missions).not.toContain(M_BIGAPPLE);
    expect(result.missions.complete_missions).toContain(M_BIGAPPLE);
    // No required_mission points to M_BIGAPPLE, so no new mission activates.
    expect(s.active_missions).toHaveLength(0);
  });
});

// ── Cold-start replay regression tests ───────────────────────────────────────
// Verify that mission progress produced by chargePerp and buyPowerup survives
// a simulated cold-start reload: capture the delta via setSendDelta, then
// replay it with applyDelta against the pre-action state and assert that
// mission_goals and active_missions reflect the completed goal.

describe('cold-start replay — chargePerp mission progress survives applyDelta', () => {
  const C007 = 'Imperium.City.Pusher0.client007';

  beforeEach(() => setOverride(FIXED_NOW));
  afterEach(() => { clearOverride(); setEmitter(null); setSendDelta(null); });

  it('chargePerp delta carries missions so mission003 goal survives reload', async () => {
    const initialState = mkState({
      game_values: mkHighGv(),
      nodes: [mkClientNode2('client007', C007)],
      active_missions: ['mission003'],
      mission_goals: [{
        mission: 'mission003', workflow: 'charge_perp', target: 'client007',
        amount: null, position: 1, current_amount: 0, complete: false
      }]
    });
    setState(initialState);

    var capturedDelta = null;
    setSendDelta(function (d) { capturedDelta = d; });

    await chargePerp(C007);
    expect(capturedDelta).not.toBeNull();

    // Simulate cold-start: replay the delta against the state that existed
    // before the charge (as if the app was killed and restarted mid-session).
    const replayed = applyDelta(initialState, capturedDelta);
    const goal = replayed.mission_goals.find(g => g.mission === 'mission003');
    expect(goal).toBeDefined();
    expect(goal.complete).toBe(true);
    expect(replayed.active_missions).not.toContain('mission003');
    expect(replayed.active_missions).toContain('mission004');
  });
});

describe('cold-start replay — buyPowerup mission progress survives applyDelta', () => {
  const P001 = 'Imperium.City.project001';

  beforeEach(() => setOverride(FIXED_NOW));
  afterEach(() => { clearOverride(); setEmitter(null); setSendDelta(null); });

  it('buyPowerup delta carries missions so mission006 partial progress survives reload', async () => {
    const initialState = mkState({
      game_values: mkHighGv({ xp_level: 2 }),
      nodes: [mkProjectNode('project001', P001)],
      active_missions: ['mission006'],
      mission_goals: [
        { mission: 'mission006', workflow: 'buy_powerup', target: 'upgrade001',
          amount: null, position: 1, current_amount: 0, complete: false },
        { mission: 'mission006', workflow: 'buy_powerup', target: 'ad002',
          amount: null, position: 2, current_amount: 0, complete: false },
        { mission: 'mission006', workflow: 'buy_powerup', target: 'teammember020',
          amount: null, position: 3, current_amount: 0, complete: false }
      ]
    });
    setState(initialState);

    var capturedDelta = null;
    setSendDelta(function (d) { capturedDelta = d; });

    await buyPowerup(P001, 0, 'upgrade001');
    expect(capturedDelta).not.toBeNull();

    // Replay the delta against the initial state (cold-start simulation).
    const replayed = applyDelta(initialState, capturedDelta);
    const goals = replayed.mission_goals.filter(g => g.mission === 'mission006');
    expect(goals.find(g => g.target === 'upgrade001').complete).toBe(true);
    expect(goals.find(g => g.target === 'ad002').complete).toBe(false);
    // Mission still active — only one of three goals complete.
    expect(replayed.active_missions).toContain('mission006');
  });
});

// ── Issue #114 regression: collectPerp leaves orphan nodes_charging on replay ─
// During live operation the materializer strips the nodes_charging entry
// in-memory before the collectPerp delta is committed, so post-handler state
// looks clean. But on cold-start replay-from-zero the chargePerp reducer adds
// to nodes_charging, the collectPerp reducer removes from nodes_collect but
// does NOT touch nodes_charging, and a subsequent materialize() with
// now >= charge_end re-promotes the orphan back into nodes_collect — so the
// UI shows the perp as collectable again after a reload.
//
// SKIPPED: the architectural fix is tracked in #120. Unskip these tests when
// the collectPerp reducer (scripts/state.js ~line 352) is taught to drop the
// matching nodes_charging entry.

describe('collectPerp — replay from zero leaves no orphan nodes_charging', () => {
  const C007 = 'Imperium.City.Pusher0.client007';

  beforeEach(() => setOverride(FIXED_NOW));
  afterEach(() => { clearOverride(); setEmitter(null); setSendDelta(null); });

  it('replay(chargePerp) + replay(collectPerp) + materialize does not leak into nodes_collect', async () => {
    // ── Setup: build a starting state with the node seeded ────────────────
    const initialState = mkState({
      game_values: mkHighGv(),
      nodes:       [mkClientNode2('client007', C007)]
    });
    setState(initialState);

    // ── Capture deltas for chargePerp and collectPerp via setSendDelta ────
    const captured = [];
    setSendDelta(function (d) { captured.push(d); });

    // 1) Charge — produces a delta that adds a nodes_charging entry.
    const chargeRes = await chargePerp(C007);
    expect(chargeRes.result.error).toBeUndefined();

    // 2) Advance the clock past charge_end so collectPerp succeeds.
    const liveState = getState();
    const chargeEntry = (liveState.nodes_charging || []).find(c => c.path === C007)
                     || (liveState.nodes_collect  || []).find(c => c.path === C007);
    // After the live materialize step the entry has moved to nodes_collect;
    // we still want a clock value strictly past charge_end for replay's
    // materialize call to fire Rule 1 unambiguously.
    const chargeEnd = chargeEntry && typeof chargeEntry.charge_end === 'number'
      ? chargeEntry.charge_end
      : FIXED_NOW + 60_000;
    setOverride(chargeEnd + 1000);

    // 3) Collect — produces a delta that drains nodes_collect.
    const collectRes = await collectPerp(C007);
    expect(collectRes.result.error).toBeUndefined();

    expect(captured.length).toBeGreaterThanOrEqual(2);

    // ── Sanity: live (post-handler) state is clean ───────────────────────
    // The materializer strips nodes_charging in-memory before the
    // collectPerp delta is built, so the live committed state has no orphan.
    const liveAfter = getState();
    const liveCharging = (liveAfter.nodes_charging || []).filter(c => c.path === C007);
    const liveCollect  = (liveAfter.nodes_collect  || []).filter(c => c.path === C007);
    expect(liveCharging).toHaveLength(0);
    expect(liveCollect).toHaveLength(0);

    // ── Replay-from-zero: apply each captured delta to a fresh state ─────
    // This simulates a cold start where boot.js replays the persisted delta
    // log without the in-memory materialize step that the live path does.
    let replayed = mkState({
      game_values: mkHighGv(),
      nodes:       [mkClientNode2('client007', C007)]
    });
    for (var i = 0; i < captured.length; i++) {
      replayed = applyDelta(replayed, captured[i]);
    }

    // After replay, materialize at a clock well past charge_end — exactly
    // what boot.js does after replaying the delta log.
    const mat = materialize(replayed, FIXED_NOW + 1_000_000);

    // ── The bug: nodes_charging still holds the entry, and materialize
    //    re-promotes it into nodes_collect, so the UI marks the perp as
    //    collectable again after a reload.
    const orphanCharging = (mat.state.nodes_charging || []).filter(c => c.path === C007);
    const orphanCollect  = (mat.state.nodes_collect  || []).filter(c => c.path === C007);
    expect(orphanCharging).toHaveLength(0);
    expect(orphanCollect).toHaveLength(0);
  });
});
