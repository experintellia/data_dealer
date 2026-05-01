/**
 * Tests for collectPerp + integrateCollected handlers (issue #17).
 *
 * Schema for nodes_collect[i].result (written by chargePerp, consumed here):
 *   { amount: number } — Thread S chargePerp schema (PR #72).
 *   XP gain is derived from ruleset type_data.xp_inc, not stored in result.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  collectPerp, integrateCollected, setEmitter, setPrngSeed
} from '../../scripts/LocalEngine.js';
import { setState } from '../../scripts/boot.js';
import { freshState } from '../../scripts/state.js';
import { setOverride, clearOverride, advance } from '../../scripts/clock.js';

// ── Fixtures ─────────────────────────────────────────────────────────────────

const FIXED_NOW  = 1_700_000_000_000;          // stable reference epoch
const CHARGE_DUR = 120_000;                    // 2 min charge
const CHARGE_END = FIXED_NOW + CHARGE_DUR;

function mkGv(overrides) {
  return Object.assign({
    xp_value: 5, xp_level: 1,
    karma_value: 50, cash_value: 300,
    profiles_value: 0, profiles_max: 1,
    ap_snapshot: 6, ap_update: FIXED_NOW,
    ap_inc_value: 1, ap_inc_interval: 120000, ap_max: 6
  }, overrides || {});
}

function mkState(overrides) {
  return Object.assign(freshState('test@local'), { game_values: mkGv() }, overrides || {});
}

function mkNode(gameType, path, instData) {
  var parts = path.split('.');
  var gestalt = parts[parts.length - 1];
  return {
    game_id:       'node_' + gestalt,
    game_type:     gameType,
    full_type:     gameType + ':' + gestalt,
    gestalt:       gestalt,
    full_path:     path,
    instance_data: instData || {}
  };
}

function mkChargingEntry(path, result, gameType) {
  var parts = path.split('.');
  var gestalt = parts[parts.length - 1];
  return {
    path:         path,
    result:       result,
    charge_start: FIXED_NOW - CHARGE_DUR,
    charge_end:   CHARGE_END,
    game_id:      'node_' + gestalt,
    game_type:    gameType
  };
}

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

    const data = await collectPerp('tok', PATH);
    expect(data.result.error).toBe(1);
  });

  it('collect after charge_end succeeds and puts entry in db_queue', async () => {
    setState(mkState({
      nodes:          [mkNode('ContactPerp', PATH)],
      nodes_charging: [mkChargingEntry(PATH, COLLECT_RESULT, 'ContactPerp')]
    }));

    // Advance past charge_end
    setOverride(CHARGE_END + 1000);

    const data = await collectPerp('tok', PATH);
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

    const { result } = await collectPerp('tok', PATH);
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

    const { result: colRes } = await collectPerp('tok', PATH);
    const collectId = colRes.result.collect_id;

    const { result: intRes } = await integrateCollected('tok', collectId);
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

    const { result: colRes } = await collectPerp('tok', PATH);
    const collectId = colRes.result.collect_id;

    // First integration.
    await integrateCollected('tok', collectId);

    // Manually re-insert the db_queue entry to simulate a retry.
    const { getState: gs, setState: ss } = await import('../../scripts/boot.js');
    const cur = gs();
    ss(Object.assign({}, cur, {
      db_queue: [{ origin: PATH, collect_id: collectId, profile_set: { profiles_value: 5, tokens_map: {} }, collect_dt: FIXED_NOW }]
    }));

    const { result: intRes2 } = await integrateCollected('tok', collectId);
    expect(intRes2.result.dup).toBe(5);
    expect(intRes2.result.increment).toBe(0);
  });

  it('xp_value is incremented by xp_gain after collect', async () => {
    setState(mkState({
      nodes:          [mkNode('ContactPerp', PATH)],
      nodes_charging: [mkChargingEntry(PATH, COLLECT_RESULT, 'ContactPerp')]
    }));
    setOverride(CHARGE_END + 1000);

    const { result } = await collectPerp('tok', PATH);
    // base xp_value = 5, contact001 xp_inc = 1 → 6
    expect(result.game_values.xp_value).toBe(6);
  });

  it('integrateCollected errors with 0 for unknown collect_id', async () => {
    setState(mkState());
    const data = await integrateCollected('tok', 'no-such-id');
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

    const { result } = await collectPerp('tok', PATH);
    expect(result.result.profile_set).toEqual({ profiles_value: 3, tokens_map: {} });
    expect(result.result.origin).toBe(PATH);
    expect(typeof result.result.collect_id).toBe('string');
  });

  it('does not return cash or token_upgraded_amount', async () => {
    setState(mkState({
      nodes:         [mkNode('ContactPerp', PATH)],
      nodes_collect: [{ path: PATH, result: { amount: 3 } }]
    }));

    const { result } = await collectPerp('tok', PATH);
    expect(result.result.cash).toBeUndefined();
    expect(result.result.token_upgraded_amount).toBeUndefined();
  });

  it('response carries game_values, levelup, and missions', async () => {
    setState(mkState({
      nodes:         [mkNode('ContactPerp', PATH)],
      nodes_collect: [{ path: PATH, result: { amount: 3 } }]
    }));

    const { result } = await collectPerp('tok', PATH);
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

    const { result } = await collectPerp('tok', PATH);
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

    const { result } = await collectPerp('tok', PATH);
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

    const { result } = await collectPerp('tok', PATH);
    expect(result.result.cash).toBe(400);
    expect(result.game_values.cash_value).toBe(400);
  });

  it('does not return profile_set or token_upgraded_amount', async () => {
    setState(mkState({
      nodes:         [mkNode('ClientPerp', PATH)],
      nodes_collect: [{ path: PATH, result: { amount: 50 } }]
    }));

    const { result } = await collectPerp('tok', PATH);
    expect(result.result.profile_set).toBeUndefined();
    expect(result.result.token_upgraded_amount).toBeUndefined();
  });

  it('does not push to db_queue', async () => {
    setState(mkState({
      nodes:         [mkNode('ClientPerp', PATH)],
      nodes_collect: [{ path: PATH, result: { amount: 50 } }]
    }));

    await collectPerp('tok', PATH);
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

    const { result } = await collectPerp('tok', PATH);
    expect(result.result.token_upgraded_amount).toBe(5);
  });

  it('updates instance_data.amount in state.nodes', async () => {
    setState(mkState({
      nodes:         [mkNode('TokenPerp', PATH, { amount: 3 })],
      nodes_collect: [{ path: PATH, result: { amount: 2 } }]
    }));

    await collectPerp('tok', PATH);
    const { getState } = await import('../../scripts/boot.js');
    const node = getState().nodes.find(n => n.full_path === PATH);
    expect(node.instance_data.amount).toBe(5);
  });

  it('does not return profile_set or cash', async () => {
    setState(mkState({
      nodes:         [mkNode('TokenPerp', PATH, { amount: 0 })],
      nodes_collect: [{ path: PATH, result: { amount: 4 } }]
    }));

    const { result } = await collectPerp('tok', PATH);
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
    const data = await collectPerp('tok', 'Imperium.City.contact001');
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

    const data = await collectPerp('tok', PATH);
    expect(data.result.error).toBe(1);
  });

  it('error 2 when path is in nodes_collect but node not in nodes array', async () => {
    const PATH = 'Imperium.City.ghost001';
    setState(mkState({
      nodes:         [],   // no matching node
      nodes_collect: [{ path: PATH, result: { amount: 0 } }]
    }));
    const data = await collectPerp('tok', PATH);
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
    const { result } = await collectPerp('tok', PATH);
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

    const { result } = await collectPerp('tok', PATH);
    expect(result.karma_incident).toBe('karma014');
  });

  it('karma_incident decreases karma_value within [-100, 100]', async () => {
    setState(mkState({
      nodes:         [mkNode('ClientPerp', PATH)],
      nodes_collect: [{ path: PATH, result: { amount: 50 } }],
      game_values:   mkGv({ karma_value: -80, xp_level: 5 })
    }));
    setPrngSeed(42);

    const { result } = await collectPerp('tok', PATH);
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

    const { result } = await collectPerp('tok', PATH);
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

  it('increments token node instance_data.amount from tokens_map', async () => {
    const tokenNode = mkNode('TokenPerp', TOKEN_PATH, { amount: 2 });
    tokenNode.gestalt = 'token_a';
    setState(mkState({
      nodes: [tokenNode],
      db_queue: [{
        origin:      'Imperium.City.contact001',
        collect_id:  COLLECT_ID,
        profile_set: { profiles_value: 4, tokens_map: { token_a: { amount: 3 } }, xp_gain: 1, karma_gain: 0 },
        collect_dt:  FIXED_NOW
      }]
    }));

    const { result } = await integrateCollected('tok', COLLECT_ID);
    expect(result.result.nodes).toHaveLength(1);
    expect(result.result.nodes[0].instance_data.amount).toBe(5);
    expect(result.result.increment).toBe(4);
    expect(result.result.dup).toBe(0);
    expect(result.game_values.profiles_value).toBe(4);
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

    const { result } = await integrateCollected('tok', COLLECT_ID);
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

    await integrateCollected('tok', COLLECT_ID);
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

    const { result } = await integrateCollected('tok', COLLECT_ID);
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

    const { result } = await integrateCollected('tok', COLLECT_ID);
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

    const { result } = await collectPerp('tok', PATH);
    expect(result.levelup).toBe(true);
    expect(result.game_values.xp_level).toBe(2);
    expect(result.game_values.ap_snapshot).toBe(8);
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

    const { result } = await integrateCollected('tok', COLLECT_ID);
    expect(result.levelup).toBe(true);
    expect(result.game_values.xp_level).toBe(2);
    expect(result.game_values.ap_snapshot).toBe(8);
  });
});

// ── #85 root cause: tokens_map is populated from typeData.tokens ────────────
//
// Contacts in the ruleset list yielded token types under `tokens`, not
// `contained_tokens` (the latter is for TokenPerp super-token decomposition).
// Each entry's `amount` is a percentage of profiles_value carrying that
// token type. Without populated tokens_map, mission goals with workflow
// "integrate_profiles" never advance — that's the 0/900 bug on mission002.

describe('collectPerp — tokens_map population from typeData.tokens (#85)', () => {
  // contact001 (Nurse Helen) has 12 tokens, each at 100%.
  const PATH = 'Imperium.City.Agent0.contact001';

  beforeEach(() => setOverride(FIXED_NOW));
  afterEach(() => { clearOverride(); setEmitter(null); });

  it('tokens_map carries an entry for every gestalt in typeData.tokens', async () => {
    setState(mkState({
      nodes:         [mkNode('ContactPerp', PATH)],
      nodes_collect: [{ path: PATH, result: { amount: 10 } }]
    }));

    const { result } = await collectPerp('tok', PATH);
    const tm = result.result.profile_set.tokens_map;
    // contact001 lists token001, token002, ..., token018, origin012 — 12 in total.
    expect(Object.keys(tm).sort()).toEqual([
      'origin012',
      'token001', 'token002', 'token003', 'token004', 'token005',
      'token006', 'token007', 'token014', 'token015', 'token017',
      'token018'
    ].sort());
  });

  it('amount is floor(percentage * profiles_value / 100)', async () => {
    setState(mkState({
      nodes:         [mkNode('ContactPerp', PATH)],
      nodes_collect: [{ path: PATH, result: { amount: 10 } }]
    }));

    const { result } = await collectPerp('tok', PATH);
    // 100% * 10 profiles / 100 = 10 tokens per gestalt.
    expect(result.result.profile_set.tokens_map.token001).toEqual({ amount: 10 });
    expect(result.result.profile_set.tokens_map.token008).toBeUndefined(); // not in contact001's list
  });

  it('Jessica (contact035) yields token008 from her tokens list — unblocks mission002', async () => {
    const JPATH = 'Imperium.CityVienna.Agent0.contact035';
    setState(mkState({
      nodes:         [mkNode('ContactPerp', JPATH)],
      nodes_collect: [{ path: JPATH, result: { amount: 1100 } }]
    }));

    const { result } = await collectPerp('tok', JPATH);
    // Jessica's token008 entry is 100% → 100% * 1100 = 1100 token008s.
    expect(result.result.profile_set.tokens_map.token008).toEqual({ amount: 1100 });
  });

  it('tokens_map stays empty when typeData.tokens is missing', async () => {
    // contact002 is not in the ruleset → typeData undefined → tokens_map empty.
    const FPATH = 'Imperium.City.Agent0.contact002';
    setState(mkState({
      nodes:         [mkNode('ContactPerp', FPATH)],
      nodes_collect: [{ path: FPATH, result: { amount: 5 } }]
    }));

    const { result } = await collectPerp('tok', FPATH);
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

    const { result } = await integrateCollected('tok', COLLECT_ID);
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

    await integrateCollected('tok', COLLECT_ID);
    const { getState } = await import('../../scripts/boot.js');
    const persisted = getState().nodes.find(function (n) { return n.gestalt === 'token008'; });
    expect(persisted.game_type).toBe('TokenPerp');
    expect(persisted.full_type).toBe('TokenPerp:token008');
  });
});
