import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  getToken, ping, getSessionLocale, setLocale, loadGame, getRanking, setEmitter,
  setDisplayName, setPerpCoordinates, buyKarma,
  buyPowerup, sellPowerup, buySlots, buyPerp,
  dismissMissionBriefing, markTokenSeen
} from '../../scripts/LocalEngine.js';
import { getState, setState } from '../../scripts/boot.js';
import { freshState, applyDelta } from '../../scripts/state.js';
import { setOverride, clearOverride } from '../../scripts/clock.js';
import { FIXED_NOW, mkState } from './_fixtures.js';

// ── getRanking ───────────────────────────────────────────────────────────────

// mkRankingState populates state.peers for the self addr so getRanking
// (which now reads state.peers, not state.game_values directly) returns a
// well-formed single-row leaderboard.  The peers entry mirrors the game_values
// set below so the two sources stay consistent.  Includes `spent` (cash_spent)
// to cover the Investor tab registered in type_settings.js.
function mkRankingState() {
  var base = mkState();  // freshState('test@local')
  var selfAddr = 'test@local';
  return Object.assign({}, base, {
    display_name: 'TestUser',
    game_values: Object.assign({}, base.game_values, {
      xp_value: 77,
      cash_value: 200,
      profiles_value: 3,
      cash_spent: 50,
      xp_level: 5,
    }),
    peers: {
      [selfAddr]: {
        display_name: 'TestUser',
        cash: 200,
        profiles: 3,
        xp: 77,
        level: 5,
        spent: 50,
        last_seen_ts: 0,
        last_seen_serial: null,
      },
    },
  });
}

describe('getRanking', () => {
  beforeEach(() => setState(mkRankingState()));

  it('returns the single-row shape with user_rank 1', async () => {
    const { result } = await getRanking('xp');
    expect(result).toHaveProperty('top');
    expect(result).toHaveProperty('user_rank', 1);
    expect(result.top).toHaveLength(1);
    expect(result.top[0]).toMatchObject({ display_name: 'TestUser', self: true });
  });

  it('xp type returns xp from peers', async () => {
    const { result } = await getRanking('xp');
    expect(result.top[0].value).toBe(77);
  });

  it('cash type returns cash from peers', async () => {
    const { result } = await getRanking('cash');
    expect(result.top[0].value).toBe(200);
  });

  it('profiles type returns profiles from peers', async () => {
    const { result } = await getRanking('profiles');
    expect(result.top[0].value).toBe(3);
  });

  it('spent type returns cash_spent from peers (Investor tab)', async () => {
    const { result } = await getRanking('spent');
    expect(result.top[0].value).toBe(50);
  });

  it('level type returns xp_level from peers', async () => {
    const { result } = await getRanking('level');
    expect(result.top[0].value).toBe(5);
  });
});

// ── getToken ─────────────────────────────────────────────────────────────────

describe('getToken', () => {
  it('resolves to an object with a non-empty string result', async () => {
    const data = await getToken();
    expect(data).toHaveProperty('result');
    expect(typeof data.result).toBe('string');
    expect(data.result.length).toBeGreaterThan(0);
  });

  it('returns the same value on repeated calls (stable)', async () => {
    const a = await getToken();
    const b = await getToken();
    expect(a.result).toBe(b.result);
  });
});

// ── ping ─────────────────────────────────────────────────────────────────────

describe('ping', () => {
  it('returns "pong"', async () => {
    const data = await ping();
    expect(data).toEqual({ result: 'pong' });
  });
});

// ── getSessionLocale ──────────────────────────────────────────────────────────

describe('getSessionLocale', () => {
  it('resolves to a non-empty string', async () => {
    setState(mkState());
    const data = await getSessionLocale();
    expect(typeof data.result).toBe('string');
    expect(data.result.length).toBeGreaterThan(0);
  });

  it('defaults to "de" when state has no locale', async () => {
    setState(mkState());
    const data = await getSessionLocale();
    expect(data.result).toBe('de');
  });
});

// ── loadGame — fresh state ────────────────────────────────────────────────────

describe('loadGame — fresh state', () => {
  beforeEach(() => setState(mkState()));

  it('resolves to an object with a result property', async () => {
    const data = await loadGame();
    expect(data).toHaveProperty('result');
  });

  it('result carries all top-level fields Game.js:1876 reads', async () => {
    const { result } = await loadGame();
    expect(result).toHaveProperty('version');
    expect(result).toHaveProperty('_id');
    expect(result).toHaveProperty('type_registry');
    expect(result).toHaveProperty('type_data');
    expect(result).toHaveProperty('user');
    expect(result).toHaveProperty('Imperium');
    expect(result).toHaveProperty('Database');
    expect(result).toHaveProperty('nodes');
    expect(result).toHaveProperty('nodes_charging');
    expect(result).toHaveProperty('nodes_collect');
    expect(result).toHaveProperty('db_queue');
    expect(result).toHaveProperty('karmalauters');
    expect(result).toHaveProperty('karmalizers');
    expect(result).toHaveProperty('server_time');
    expect(result).toHaveProperty('missions');
    expect(result).toHaveProperty('mission_goals');
    expect(result).toHaveProperty('active_missions');
  });

  it('version is a string', async () => {
    const { result } = await loadGame();
    expect(typeof result.version).toBe('string');
  });

  it('_id is the selfAddr from state', async () => {
    const { result } = await loadGame();
    expect(result._id).toBe('test@local');
  });

  it('user.auth_username is the selfAddr', async () => {
    const { result } = await loadGame();
    expect(result.user.auth_username).toBe('test@local');
  });

  it('Imperium has required shape', async () => {
    const { result } = await loadGame();
    expect(result.Imperium).toMatchObject({
      game_id: 'Imperium',
      full_path: 'Imperium',
      instance_data: expect.any(Object),
      type_data: expect.any(Object)
    });
  });

  it('Database has required shape', async () => {
    const { result } = await loadGame();
    expect(result.Database).toMatchObject({
      game_id: 'Database',
      full_path: 'Database',
      instance_data: expect.any(Object),
      type_data: expect.any(Object)
    });
  });

  it('server_time is an ExtJSON date object', async () => {
    const { result } = await loadGame();
    expect(result.server_time).toHaveProperty('$date');
    expect(typeof result.server_time.$date).toBe('number');
    expect(result.server_time.$date).toBeGreaterThan(0);
  });

  it('type_registry is a non-empty object', async () => {
    const { result } = await loadGame();
    expect(typeof result.type_registry).toBe('object');
    expect(Object.keys(result.type_registry).length).toBeGreaterThan(0);
  });

  it('type_data includes levels array for getLevelByXP', async () => {
    const { result } = await loadGame();
    expect(Array.isArray(result.type_data.levels)).toBe(true);
    expect(result.type_data.levels.length).toBeGreaterThan(0);
  });

  it('missions is an array', async () => {
    const { result } = await loadGame();
    expect(Array.isArray(result.missions)).toBe(true);
    expect(result.missions.length).toBeGreaterThan(0);
  });

  it('karmalauters and karmalizers are non-empty arrays', async () => {
    const { result } = await loadGame();
    expect(Array.isArray(result.karmalauters)).toBe(true);
    expect(result.karmalauters.length).toBeGreaterThan(0);
    expect(Array.isArray(result.karmalizers)).toBe(true);
    expect(result.karmalizers.length).toBeGreaterThan(0);
  });

  it('is_new_game is true for empty nodes array', async () => {
    const { result } = await loadGame();
    expect(result.is_new_game).toBe(true);
  });

  it('nodes is an array (empty for fresh game)', async () => {
    const { result } = await loadGame();
    expect(Array.isArray(result.nodes)).toBe(true);
  });

  it('game_values inside type_data has ap_initial and ap_offset', async () => {
    const { result } = await loadGame();
    const gv = result.type_data.game_values;
    expect(gv).toBeDefined();
    expect(typeof gv.ap_initial).toBe('number');
    expect(typeof gv.ap_offset).toBe('number');
  });
});

// ── loadGame — replayed history ───────────────────────────────────────────────

describe('loadGame — replayed state', () => {
  it('returns the evolved state when deltas have been applied', async () => {
    // Start from fresh, apply a loadGame delta that carries some game_values.
    var s = freshState('player@example');
    // Simulate a prior loadGame having bumped cash_value via a delta.
    var delta = {
      kind: 'delta', addr: 'player@example',
      op: 'loadGame', args: [], result: {}, ts: Date.now()
    };
    var evolved = applyDelta(s, delta);
    // The stub reducer returns state unchanged — but addr and schema_version persist.
    setState(evolved);

    const { result } = await loadGame();
    expect(result._id).toBe('player@example');
    expect(result.version).toBeDefined();
  });

  it('is_new_game is false once the player has bought something', async () => {
    // node_counter > 0 marks a returning player — bumped only by buyPerp,
    // never by the seed.  The freshState seed already populates s.nodes,
    // so length-of-nodes alone can no longer distinguish new from returning.
    var s = Object.assign({}, freshState('p@x'), { node_counter: 1 });
    setState(s);

    const { result } = await loadGame();
    expect(result.is_new_game).toBe(false);
  });
});

// ── buyKarma ─────────────────────────────────────────────────────────────────

// karma001: price=250, karma_points=5, required_level=5
const KARMA_GESTALT = 'karma001';
const KARMA_PRICE   = 250;
const KARMA_POINTS  = 5;

describe('buyKarma — happy path', () => {
  beforeEach(() => {
    setState(mkState({
      game_values: {
        xp_value: 1, xp_level: 1, cash_value: 1000, cash_spent: 0,
        karma_value: 50, profiles_value: 0, profiles_max: 1,
        ap_snapshot: 6, ap_update: null
      }
    }));
  });

  it('resolves to an object with a result property', async () => {
    const data = await buyKarma(KARMA_GESTALT);
    expect(data).toHaveProperty('result');
  });

  it('result has game_values but no error', async () => {
    const { result } = await buyKarma(KARMA_GESTALT);
    expect(result.error).toBeUndefined();
    expect(result.game_values).toBeDefined();
  });

  it('deducts the price from cash_value', async () => {
    const { result } = await buyKarma(KARMA_GESTALT);
    expect(result.game_values.cash_value).toBe(1000 - KARMA_PRICE);
  });

  it('adds the price to cash_spent', async () => {
    const { result } = await buyKarma(KARMA_GESTALT);
    expect(result.game_values.cash_spent).toBe(KARMA_PRICE);
  });

  it('increments karma_value by karma_points', async () => {
    const { result } = await buyKarma(KARMA_GESTALT);
    expect(result.game_values.karma_value).toBe(50 + KARMA_POINTS);
  });

  it('increments xp_value by karma_points', async () => {
    const { result } = await buyKarma(KARMA_GESTALT);
    expect(result.game_values.xp_value).toBe(1 + KARMA_POINTS);
  });

  it('does not include a missions field', async () => {
    const { result } = await buyKarma(KARMA_GESTALT);
    expect(result.missions).toBeUndefined();
  });

  it('persists game_values into state', async () => {
    await buyKarma(KARMA_GESTALT);
    expect(getState().game_values.cash_value).toBe(1000 - KARMA_PRICE);
    expect(getState().game_values.karma_value).toBe(50 + KARMA_POINTS);
  });

  it('clamps karma_value at 100 when already near the cap', async () => {
    setState(mkState({
      game_values: {
        xp_value: 1, xp_level: 1, cash_value: 9999, cash_spent: 0,
        karma_value: 98, profiles_value: 0, profiles_max: 1,
        ap_snapshot: 6, ap_update: null
      }
    }));
    // karma001 karma_points=5; 98+5=103 → clamped to 100
    const { result } = await buyKarma(KARMA_GESTALT);
    expect(result.game_values.karma_value).toBe(100);
  });

  it('clamps karma_value at -100 when already below the floor', async () => {
    setState(mkState({
      game_values: {
        xp_value: 1, xp_level: 1, cash_value: 9999, cash_spent: 0,
        karma_value: -106, profiles_value: 0, profiles_max: 1,
        ap_snapshot: 6, ap_update: null
      }
    }));
    // karma001 karma_points=5; -106+5=-101 → clamped to -100
    const { result } = await buyKarma(KARMA_GESTALT);
    expect(result.game_values.karma_value).toBe(-100);
  });
});

describe('buyKarma — failure: insufficient cash', () => {
  beforeEach(() => {
    setState(mkState({
      game_values: {
        xp_value: 1, xp_level: 1, cash_value: 10, cash_spent: 0,
        karma_value: 0, profiles_value: 0, profiles_max: 1,
        ap_snapshot: 6, ap_update: null
      }
    }));
  });

  it('resolves with error when cash is below price', async () => {
    const { result } = await buyKarma(KARMA_GESTALT);
    expect(result.error).toBeDefined();
  });

  it('does not mutate state on cash failure', async () => {
    const before = getState().game_values.cash_value;
    await buyKarma(KARMA_GESTALT);
    expect(getState().game_values.cash_value).toBe(before);
  });
});

describe('buyKarma — failure: unknown karmalauter', () => {
  beforeEach(() => {
    setState(mkState({
      game_values: {
        xp_value: 1, xp_level: 1, cash_value: 9999, cash_spent: 0,
        karma_value: 0, profiles_value: 0, profiles_max: 1,
        ap_snapshot: 6, ap_update: null
      }
    }));
  });

  it('resolves with error for an unknown gestalt', async () => {
    const { result } = await buyKarma('karma_does_not_exist');
    expect(result.error).toBeDefined();
  });
});

// ── materialization on boot ───────────────────────────────────────────────────

describe('materialization on boot', () => {
  beforeEach(() => setOverride(FIXED_NOW));
  afterEach(() => {
    clearOverride();
    setEmitter(null);
  });

  it('emits a node_ready event for a charge that completed during the away window', async () => {
    const emitted = [];
    setEmitter(function(ev, pl) { emitted.push({ ev, pl }); });

    const chargeEnd = FIXED_NOW - 10000; // completed 10 s before frozen "now"
    const s = mkState({
      nodes_charging: [{
        path: 'Imperium.City.contact001',
        result: { value: 42 },
        charge_start: chargeEnd - 120000,
        charge_end: chargeEnd,
        game_id: 'abc123',
        game_type: 'ContactPerp'
      }]
    });
    setState(s);

    await loadGame();

    // queueMicrotask fires before the next await / assertion cycle.
    await Promise.resolve();

    expect(emitted).toHaveLength(1);
    expect(emitted[0].ev).toBe('node_ready');
    expect(emitted[0].pl).toMatchObject({
      id:   'abc123',
      type: 'ContactPerp',
      path: 'Imperium.City.contact001'
    });
  });

  it('moves the completed charge to nodes_collect in the persisted state', async () => {
    setEmitter(function() {});

    const chargeEnd = FIXED_NOW - 5000;
    const s = mkState({
      nodes_charging: [{
        path: 'Imperium.City.contact002',
        result: { value: 10 },
        charge_start: chargeEnd - 60000,
        charge_end: chargeEnd,
        game_id: 'def456',
        game_type: 'ContactPerp'
      }]
    });
    setState(s);

    await loadGame();

    // After loadGame, the materialised state should have been persisted.
    const { result } = await loadGame();
    // Second call: charge already moved, no further changes expected.
    expect(result.nodes_charging).toHaveLength(0);
    expect(result.nodes_collect).toHaveLength(1);
    expect(result.nodes_collect[0].path).toBe('Imperium.City.contact002');
  });

  it('emits no events when there are no completed charges', async () => {
    const emitted = [];
    setEmitter(function(ev, pl) { emitted.push({ ev, pl }); });

    setState(mkState());
    await loadGame();
    await Promise.resolve();

    expect(emitted).toHaveLength(0);
  });

  it('AP regen survives reload — first loadGame seeds the clock, second ticks', async () => {
    setOverride(FIXED_NOW);
    setState(mkState({
      game_values: Object.assign({}, freshState('test@local').game_values, {
        ap_snapshot: 0, ap_update: null
      })
    }));

    // First load seeds ap_update without granting any ticks.
    await loadGame();
    expect(getState().game_values.ap_update).toBe(FIXED_NOW);
    expect(getState().game_values.ap_snapshot).toBe(0);

    // Two minutes later (one ap_inc_interval at level 1) → +1 AP.
    setOverride(FIXED_NOW + 120000);
    await loadGame();
    expect(getState().game_values.ap_snapshot).toBe(1);
    expect(getState().game_values.ap_update).toBe(FIXED_NOW + 120000);
  });
});

// ── setDisplayName ────────────────────────────────────────────────────────────

describe('setDisplayName — happy path', () => {
  beforeEach(() => setState(mkState()));

  it('returns {} (no error field) on a valid name', async () => {
    const data = await setDisplayName('Alice');
    expect(data).toEqual({ result: {} });
    expect(data.result.error).toBeUndefined();
  });

  it('persists display_name in in-memory state', async () => {
    await setDisplayName('Alice');
    expect(getState().display_name).toBe('Alice');
  });

  it('accepts names up to 30 characters', async () => {
    const name30 = 'A'.repeat(30);
    const data = await setDisplayName(name30);
    expect(data.result.error).toBeUndefined();
    expect(getState().display_name).toBe(name30);
  });
});

describe('setDisplayName — failure modes', () => {
  beforeEach(() => setState(mkState()));

  it('returns {error: 0} for an empty string', async () => {
    const data = await setDisplayName('');
    expect(data.result.error).toBe(0);
  });

  it('returns {error: 0} for a whitespace-only string', async () => {
    const data = await setDisplayName('   ');
    expect(data.result.error).toBe(0);
  });

  it('returns {error: 0} for a name exceeding 30 characters', async () => {
    const data = await setDisplayName('A'.repeat(31));
    expect(data.result.error).toBe(0);
  });

  it('does not mutate state on invalid input', async () => {
    const before = getState().display_name;
    await setDisplayName('');
    expect(getState().display_name).toBe(before);
  });
});

// ── setPerpCoordinates ────────────────────────────────────────────────────────

function mkStateWithNodes() {
  return mkState({
    nodes: [
      {
        game_id: 'n1', game_type: 'ContactPerp',
        full_path: 'Imperium.City.Agent0',
        full_type: 'ContactPerp:Agent0',
        instance_data: { x: 0, y: 0 }
      },
      {
        game_id: 'n2', game_type: 'ProjectPerp',
        full_path: 'Imperium.City.Project1',
        full_type: 'ProjectPerp:Project1',
        instance_data: { x: 10, y: 20 }
      }
    ]
  });
}

describe('setPerpCoordinates — happy path', () => {
  beforeEach(() => setState(mkStateWithNodes()));

  it('returns {result: 1}', async () => {
    const data = await setPerpCoordinates([
      ['Imperium.City.Agent0', { x: 5, y: 7 }]
    ]);
    expect(data).toEqual({ result: 1 });
  });

  it('updates x/y on matched node', async () => {
    await setPerpCoordinates([
      ['Imperium.City.Agent0', { x: 42, y: 99 }]
    ]);
    const node = getState().nodes.find(n => n.full_path === 'Imperium.City.Agent0');
    expect(node.instance_data.x).toBe(42);
    expect(node.instance_data.y).toBe(99);
  });

  it('updates multiple nodes in a single call', async () => {
    await setPerpCoordinates([
      ['Imperium.City.Agent0',   { x: 1, y: 2 }],
      ['Imperium.City.Project1', { x: 3, y: 4 }]
    ]);
    const nodes = getState().nodes;
    const a = nodes.find(n => n.full_path === 'Imperium.City.Agent0');
    const p = nodes.find(n => n.full_path === 'Imperium.City.Project1');
    expect(a.instance_data).toMatchObject({ x: 1, y: 2 });
    expect(p.instance_data).toMatchObject({ x: 3, y: 4 });
  });
});

describe('setPerpCoordinates — failure modes', () => {
  beforeEach(() => setState(mkStateWithNodes()));

  it('returns {result: 1} (not an error) for an empty updates array', async () => {
    const data = await setPerpCoordinates([]);
    expect(data).toEqual({ result: 1 });
  });

  it('silently skips a malformed entry (non-array element)', async () => {
    const data = await setPerpCoordinates([
      'not-an-array',
      ['Imperium.City.Agent0', { x: 7, y: 8 }]
    ]);
    expect(data).toEqual({ result: 1 });
    const node = getState().nodes.find(n => n.full_path === 'Imperium.City.Agent0');
    expect(node.instance_data.x).toBe(7);
  });

  it('leaves unmatched nodes unchanged', async () => {
    await setPerpCoordinates([
      ['Imperium.City.NoSuchNode', { x: 99, y: 99 }]
    ]);
    const node = getState().nodes.find(n => n.full_path === 'Imperium.City.Agent0');
    expect(node.instance_data.x).toBe(0);
    expect(node.instance_data.y).toBe(0);
  });
});

// ── purchase-op fixtures ──────────────────────────────────────────────────────

// A minimal ProjectPerp node using the real project001 ruleset entry.
// Starts with empty powerups and default ad_slots from type_data (3).
var PROJECT_NODE = {
  game_id:       'proj001',
  game_type:     'ProjectPerp',
  full_path:     'Imperium.CityVienna.proj001',
  full_type:     'ProjectPerp:project001',
  gestalt:       'project001',
  instance_data: {
    x: 100, y: 100,
    powerups: []
  }
};

// State with enough cash for any normal purchase (default seed: 270).
function mkProjectState(overrides) {
  var base = freshState('test@local');
  return Object.assign({}, base, { nodes: [PROJECT_NODE] }, overrides || {});
}

// ── buyPowerup ────────────────────────────────────────────────────────────────

describe('buyPowerup — happy path', () => {
  beforeEach(() => setState(mkProjectState()));

  it('returns node, game_values, and levelup', async () => {
    const { result } = await buyPowerup(PROJECT_NODE.full_path, 0, 'ad002');
    expect(result).not.toHaveProperty('error');
    expect(result).toHaveProperty('node');
    expect(result).toHaveProperty('game_values');
    expect(typeof result.levelup).toBe('boolean');
  });

  it('pushes the powerup into instance_data.powerups', async () => {
    const { result } = await buyPowerup(PROJECT_NODE.full_path, 0, 'ad002');
    const powerups = result.node.instance_data.powerups;
    expect(powerups).toHaveLength(1);
    expect(powerups[0]).toMatchObject({ slot: 0, gestalt: 'ad002', full_type: 'AdPowerup:ad002' });
  });

  it('deducts the powerup price from cash_value', async () => {
    // ad002 price = 90 (from project001 provided_ads)
    const before = getState().game_values.cash_value;
    const { result } = await buyPowerup(PROJECT_NODE.full_path, 0, 'ad002');
    expect(result.game_values.cash_value).toBe(before - 90);
  });

  it('increments cash_spent by the powerup price', async () => {
    const before = getState().game_values.cash_spent;
    const { result } = await buyPowerup(PROJECT_NODE.full_path, 0, 'ad002');
    expect(result.game_values.cash_spent).toBe(before + 90);
  });

  it('increments xp_value', async () => {
    const before = getState().game_values.xp_value;
    const { result } = await buyPowerup(PROJECT_NODE.full_path, 0, 'ad002');
    expect(result.game_values.xp_value).toBeGreaterThan(before);
  });

  it('increments karma_value by 1', async () => {
    const before = getState().game_values.karma_value;
    const { result } = await buyPowerup(PROJECT_NODE.full_path, 0, 'ad002');
    expect(result.game_values.karma_value).toBe(before + 1);
  });

  it('applies charge_cost_modifier to charge_cost', async () => {
    // project001 base charge_cost=190, ad002 modifier=35 → 225
    const { result } = await buyPowerup(PROJECT_NODE.full_path, 0, 'ad002');
    expect(result.node.instance_data.charge_cost).toBe(225);
  });

  it('applies collect_amount_modifier', async () => {
    // base 3600 + 160 = 3760
    const { result } = await buyPowerup(PROJECT_NODE.full_path, 0, 'ad002');
    expect(result.node.instance_data.collect_amount).toBe(3760);
  });

  it('persists updated state', async () => {
    await buyPowerup(PROJECT_NODE.full_path, 0, 'ad002');
    const s = getState();
    expect(s.nodes[0].instance_data.powerups).toHaveLength(1);
    expect(s.game_values.cash_value).toBe(270 - 90);
  });
});

describe('buyPowerup — failure: slot occupied', () => {
  it('returns error:1 when the requested slot already holds a powerup of the same type', async () => {
    const occupiedNode = Object.assign({}, PROJECT_NODE, {
      instance_data: { powerups: [{ slot: 0, gestalt: 'ad002', full_type: 'AdPowerup:ad002' }] }
    });
    setState(Object.assign({}, freshState('test@local'), { nodes: [occupiedNode] }));
    const { result } = await buyPowerup(PROJECT_NODE.full_path, 0, 'ad003');
    expect(result.error).toBe(1);
  });

  it('does NOT block slot 0 for a different powerup type even if same slot index is taken', async () => {
    // Ad slot 0 is occupied; upgrade slot 0 is independent and must remain free.
    const occupiedNode = Object.assign({}, PROJECT_NODE, {
      instance_data: { powerups: [{ slot: 0, gestalt: 'ad002', full_type: 'AdPowerup:ad002' }] }
    });
    setState(Object.assign({}, freshState('test@local'), { nodes: [occupiedNode] }));
    const { result } = await buyPowerup(PROJECT_NODE.full_path, 0, 'upgrade001');
    expect(result).not.toHaveProperty('error');
  });
});

describe('buyPowerup — failure: insufficient cash', () => {
  it('returns error:3 when cash_value < powerup price', async () => {
    const broke = mkProjectState({
      game_values: Object.assign({}, freshState('test@local').game_values, { cash_value: 5 })
    });
    setState(broke);
    const { result } = await buyPowerup(PROJECT_NODE.full_path, 0, 'ad002');
    expect(result.error).toBe(3);
  });
});

// ── sellPowerup ───────────────────────────────────────────────────────────────

// State with ad002 already occupying slot 0.
function mkStateWithPowerup() {
  var nodeWithPu = Object.assign({}, PROJECT_NODE, {
    instance_data: {
      x: 100, y: 100,
      powerups: [{ slot: 0, gestalt: 'ad002', full_type: 'AdPowerup:ad002' }],
      charge_cost:    225,  // after ad002 modifiers
      collect_amount: 3760,
      collect_risk:   2
    }
  });
  return Object.assign({}, freshState('test@local'), { nodes: [nodeWithPu] });
}

describe('sellPowerup — happy path', () => {
  beforeEach(() => setState(mkStateWithPowerup()));

  it('returns node, game_values, and levelup', async () => {
    const { result } = await sellPowerup(PROJECT_NODE.full_path, 0, 'ad002');
    expect(result).not.toHaveProperty('error');
    expect(result).toHaveProperty('node');
    expect(result).toHaveProperty('game_values');
    expect(typeof result.levelup).toBe('boolean');
  });

  it('removes the powerup from instance_data.powerups', async () => {
    const { result } = await sellPowerup(PROJECT_NODE.full_path, 0, 'ad002');
    expect(result.node.instance_data.powerups).toHaveLength(0);
  });

  it('refunds 75% of the powerup price (floor)', async () => {
    // ad002 price=90, refund=floor(90*0.75)=67
    const before = getState().game_values.cash_value;
    const { result } = await sellPowerup(PROJECT_NODE.full_path, 0, 'ad002');
    expect(result.game_values.cash_value).toBe(before + 67);
  });

  it('increments xp_value', async () => {
    const before = getState().game_values.xp_value;
    const { result } = await sellPowerup(PROJECT_NODE.full_path, 0, 'ad002');
    expect(result.game_values.xp_value).toBeGreaterThan(before);
  });

  it('resets charge_cost to base value after powerup removed', async () => {
    // project001 base charge_cost = 190
    const { result } = await sellPowerup(PROJECT_NODE.full_path, 0, 'ad002');
    expect(result.node.instance_data.charge_cost).toBe(190);
  });

  it('resets collect_amount to base value', async () => {
    const { result } = await sellPowerup(PROJECT_NODE.full_path, 0, 'ad002');
    expect(result.node.instance_data.collect_amount).toBe(3600);
  });

  it('persists updated state', async () => {
    await sellPowerup(PROJECT_NODE.full_path, 0, 'ad002');
    const s = getState();
    expect(s.nodes[0].instance_data.powerups).toHaveLength(0);
  });
});

describe('sellPowerup — failure: slot empty', () => {
  it('returns error:1 when the slot has no powerup', async () => {
    setState(mkProjectState());
    const { result } = await sellPowerup(PROJECT_NODE.full_path, 99, 'ad002');
    expect(result.error).toBe(1);
  });
});

// ── buyPerp ───────────────────────────────────────────────────────────────────
//
// Ruleset fixtures used:
//   contact001 — ContactPerp, price 400, required_level 3, xp_inc 1
//   city002    — CityPerp,    price 0,   required_level 1, profiles_max 2915918
//   proxy001   — ProxyPerp,   price 100, required_level 2, max_slots 3
//   project001 — ProjectPerp (inside proxy001), price 300, required_level 2, xp_inc 2
//
// Parent paths:
//   "Imperium.agent001"  — fake resolved AgentPerp used for contact001 tests
//   "Imperium"           — root, always valid
// ---------------------------------------------------------------------------

function mkBuyPerpState(overrides) {
  // Level-3 player with ample cash; no nodes yet.
  return Object.assign(freshState('buyer@local'), {
    game_values: {
      xp_value: 15, xp_level: 3,
      cash_value: 10000, cash_spent: 0,
      karma_value: 0, profiles_value: 0, profiles_max: 1,
      ap_snapshot: 6, ap_update: null
    }
  }, overrides || {});
}

describe('buyPerp — happy path (contact gestalt)', () => {
  beforeEach(() => setState(mkBuyPerpState()));

  it('resolves to a result with node, game_values, levelup, missions', async () => {
    // contact001 requires level 3, price 400; state has level 3 and 10000 cash.
    // Parent is Imperium (root, always valid; contact001 not in Imperium provided_perps so
    // provided_perps check is skipped when parent type cannot be resolved).
    const data = await buyPerp('Imperium', 'contact001');
    expect(data.result).toBeDefined();
    expect(data.result.error).toBeUndefined();
    expect(data.result.node).toBeDefined();
    expect(data.result.game_values).toBeDefined();
    expect(typeof data.result.levelup).toBe('boolean');
  });

  it('node has the correct shape', async () => {
    const { result } = await buyPerp('Imperium', 'contact001');
    expect(result.node).toMatchObject({
      game_id: expect.any(String),
      game_type: 'ContactPerp',
      full_type: 'ContactPerp:contact001',
      gestalt: 'contact001',
      full_path: 'Imperium.contact001',
      instance_data: expect.any(Object)
    });
  });

  it('deducts price from cash_value', async () => {
    // contact001 price = 400
    const { result } = await buyPerp('Imperium', 'contact001');
    expect(result.game_values.cash_value).toBe(10000 - 400);
    expect(result.game_values.cash_spent).toBe(400);
  });

  it('increments xp_value by xp_inc', async () => {
    // contact001 xp_inc = 1
    const { result } = await buyPerp('Imperium', 'contact001');
    expect(result.game_values.xp_value).toBe(15 + 1);
  });

  it('adds node to in-memory state', async () => {
    await buyPerp('Imperium', 'contact001');
    const s = getState();
    // freshState already includes the seeded database001, so a buy adds a 2nd entry.
    expect(s.nodes.find((n) => n.full_path === 'Imperium.contact001')).toBeTruthy();
  });

  it('returns profile_set for contact* gestalt', async () => {
    const { result } = await buyPerp('Imperium', 'contact001');
    expect(result.profile_set).toBeDefined();
    expect(result.profile_set).toHaveProperty('profile_set');
    expect(result.profile_set).toHaveProperty('origin', 'Imperium.contact001');
    expect(result.profile_set).toHaveProperty('collect_id');
  });

  it('pushes a db_queue entry for contact* gestalt', async () => {
    await buyPerp('Imperium', 'contact001');
    const s = getState();
    expect(s.db_queue).toHaveLength(1);
    expect(s.db_queue[0].origin).toBe('Imperium.contact001');
  });

  it('game_id is stable and unique across two buys', async () => {
    const r1 = await buyPerp('Imperium', 'contact001');
    // city002: required_level 1, price 0 — always accessible
    await buyPerp('Imperium', 'city002');
    const s = getState();
    const ids = s.nodes.map(function(n) { return n.game_id; });
    expect(new Set(ids).size).toBe(ids.length);  // all unique (seed + 2 buys)
    expect(r1.result.node.game_id).toBe('contact001');
  });
});

describe('buyPerp — happy path (city gestalt, profiles_max bump)', () => {
  beforeEach(() => setState(mkBuyPerpState()));

  it('city002 (price 0) succeeds and bumps profiles_max', async () => {
    const { result } = await buyPerp('Imperium', 'city002');
    expect(result.error).toBeUndefined();
    // profiles_max += 2915918
    expect(result.game_values.profiles_max).toBe(1 + 2915918);
  });

  it('returns profile_set for city* gestalt', async () => {
    const { result } = await buyPerp('Imperium', 'city002');
    expect(result.profile_set).toBeDefined();
    expect(result.profile_set.origin).toBe('Imperium.city002');
  });
});

describe('buyPerp — happy path delta replay (applyDelta roundtrip)', () => {
  it('state persists across applyDelta replay', async () => {
    const initialState = mkBuyPerpState();
    setState(initialState);

    const { result } = await buyPerp('Imperium', 'contact001');

    // Construct the delta as LocalEngine emitted it and replay from scratch.
    const replayBase = freshState('buyer@local');
    // We seed game_values so cash floor is satisfied in the reducer.
    const seedState = Object.assign({}, replayBase, {
      game_values: initialState.game_values
    });

    const delta = {
      kind: 'delta',
      addr: 'buyer@local',
      op: 'buyPerp',
      args: ['Imperium', 'contact001'],
      result: result,
      ts: Date.now()
    };

    const replayed = applyDelta(seedState, delta);
    // freshState seed contributes database001; replay adds the bought contact001.
    expect(replayed.nodes.find((n) => n.full_path === 'Imperium.contact001')).toBeTruthy();
    expect(replayed.game_values.cash_value).toBe(10000 - 400);
    expect(replayed.node_counter).toBe(1);
  });
});

describe('buyPerp — failure: insufficient cash', () => {
  it('returns error 2 when cash_value < price', async () => {
    setState(mkBuyPerpState({ game_values: {
      xp_value: 15, xp_level: 3,
      cash_value: 100, cash_spent: 0,  // contact001 costs 400
      karma_value: 0, profiles_value: 0, profiles_max: 1,
      ap_snapshot: 6, ap_update: null
    }}));
    const { result } = await buyPerp('Imperium', 'contact001');
    expect(result.error).toBe(2);
  });

  it('does not add a node on cash failure', async () => {
    setState(mkBuyPerpState({ game_values: {
      xp_value: 15, xp_level: 3,
      cash_value: 50, cash_spent: 0,
      karma_value: 0, profiles_value: 0, profiles_max: 1,
      ap_snapshot: 6, ap_update: null
    }}));
    await buyPerp('Imperium', 'contact001');
    expect(getState().nodes.find((n) => n.gestalt === 'contact001')).toBeUndefined();
  });
});

describe('buyPerp — failure: level too low', () => {
  it('returns error 1 when xp_level < required_level', async () => {
    // contact001 requires level 3; state is level 1
    setState(mkBuyPerpState({ game_values: {
      xp_value: 0, xp_level: 1,
      cash_value: 10000, cash_spent: 0,
      karma_value: 0, profiles_value: 0, profiles_max: 1,
      ap_snapshot: 6, ap_update: null
    }}));
    const { result } = await buyPerp('Imperium', 'contact001');
    expect(result.error).toBe(1);
  });
});

// ── buySlots ──────────────────────────────────────────────────────────────────

describe('buySlots — happy path', () => {
  beforeEach(() => setState(mkProjectState()));

  it('returns node, game_values, and levelup', async () => {
    const { result } = await buySlots(PROJECT_NODE.full_path, 'ad', 1);
    expect(result).not.toHaveProperty('error');
    expect(result).toHaveProperty('node');
    expect(result).toHaveProperty('game_values');
    expect(typeof result.levelup).toBe('boolean');
  });

  it('increments the ad_slots count by num', async () => {
    // base ad_slots from type_data = 3; buy 1 → 4
    const { result } = await buySlots(PROJECT_NODE.full_path, 'ad', 1);
    expect(result.node.instance_data.ad_slots).toBe(4);
  });

  it('deducts the correct cost from cash_value', async () => {
    // cost = slot_cost + slot_cost_modifier * currentSlots = 10 + 1*3 = 13
    const before = getState().game_values.cash_value;
    const { result } = await buySlots(PROJECT_NODE.full_path, 'ad', 1);
    expect(result.game_values.cash_value).toBe(before - 13);
  });

  it('increments cash_spent by the slot cost', async () => {
    const before = getState().game_values.cash_spent;
    const { result } = await buySlots(PROJECT_NODE.full_path, 'ad', 1);
    expect(result.game_values.cash_spent).toBe(before + 13);
  });

  it('increments xp_value', async () => {
    const before = getState().game_values.xp_value;
    const { result } = await buySlots(PROJECT_NODE.full_path, 'ad', 1);
    expect(result.game_values.xp_value).toBeGreaterThan(before);
  });

  it('persists updated state', async () => {
    await buySlots(PROJECT_NODE.full_path, 'ad', 1);
    const s = getState();
    expect(s.nodes[0].instance_data.ad_slots).toBe(4);
  });
});

describe('buySlots — failure: insufficient cash', () => {
  it('returns error:3 when cash_value < slot cost', async () => {
    const broke = mkProjectState({
      game_values: Object.assign({}, freshState('test@local').game_values, { cash_value: 0 })
    });
    setState(broke);
    const { result } = await buySlots(PROJECT_NODE.full_path, 'ad', 1);
    expect(result.error).toBe(3);
  });
});

describe('buyPerp — failure: ProxyPerp slot full', () => {
  it('returns error 3 when proxy max_slots is reached', async () => {
    // proxy001 has max_slots=3.  Pre-fill 3 project children.
    const proxyNode = {
      game_id: 'node_0', game_type: 'ProxyPerp',
      full_type: 'ProxyPerp:proxy001', gestalt: 'proxy001',
      full_path: 'Imperium.proxy001', instance_data: {}
    };
    const childNodes = ['project001','project002','project003'].map(function(g, i) {
      return {
        game_id: 'node_c' + i, game_type: 'ProjectPerp',
        full_type: 'ProjectPerp:' + g, gestalt: g,
        full_path: 'Imperium.proxy001.' + g, instance_data: {}
      };
    });
    // project005 requires level 7 — boost xp_level so level check passes
    // and only the slot check (error 3) triggers.
    const highLevelValues = Object.assign({}, mkBuyPerpState().game_values, { xp_level: 7, xp_value: 200, cash_value: 10000 });
    setState(mkBuyPerpState({ nodes: [proxyNode].concat(childNodes), game_values: highLevelValues }));

    // Try to buy a 4th project (project005 is also in proxy001 provided_perps)
    const { result } = await buyPerp('Imperium.proxy001', 'project005');
    expect(result.error).toBe(3);
  });
});

describe('buyPerp — failure: duplicate gestalt', () => {
  it('returns error 4 when gestalt already exists under parent', async () => {
    const existing = {
      game_id: 'node_1', game_type: 'ContactPerp',
      full_type: 'ContactPerp:contact001', gestalt: 'contact001',
      full_path: 'Imperium.contact001', instance_data: {}
    };
    setState(mkBuyPerpState({ nodes: [existing] }));
    const { result } = await buyPerp('Imperium', 'contact001');
    expect(result.error).toBe(4);
  });
});

describe('buyPerp — failure: unknown gestalt', () => {
  it('returns error 1 for a gestalt not in the ruleset', async () => {
    setState(mkBuyPerpState());
    const { result } = await buyPerp('Imperium', 'noSuchPerp');
    expect(result.error).toBe(1);
  });
});

// ── level-up: buyPerp's xp_inc crosses a threshold ─────────────────────────
//
// contact001 requires level 3 (xp_min=31, xp_max=54), xp_inc=1. Setting
// xp_value=54, xp_level=3 means the next 1-XP buy lands the player at
// xp=55 = level 4 (xp_min=55, xp_max=80, ap_max=14).

describe('buyPerp — level-up refills ap_snapshot', () => {
  beforeEach(() => {
    setState(Object.assign(mkBuyPerpState(), {
      game_values: {
        xp_value: 54, xp_level: 3,
        cash_value: 10000, cash_spent: 0,
        karma_value: 0, profiles_value: 0, profiles_max: 1,
        ap_snapshot: 1, ap_update: null
      }
    }));
  });

  it('returns levelup=true', async () => {
    const { result } = await buyPerp('Imperium', 'contact001');
    expect(result.error).toBeUndefined();
    expect(result.levelup).toBe(true);
  });

  it('advances xp_level and refills AP to the new level\'s ap_max', async () => {
    const { result } = await buyPerp('Imperium', 'contact001');
    expect(result.game_values.xp_level).toBe(4);
    expect(result.game_values.ap_snapshot).toBe(14);
    expect(result.game_values.ap_max).toBe(14);
  });
});

// ── buyPerp — stuck mission repair ───────────────────────────────────────────

const NURSE_NODE = {
  game_id:       'contact001',
  game_type:     'ContactPerp',
  full_type:     'ContactPerp:contact001',
  gestalt:       'contact001',
  full_path:     'Imperium.contact001',
  instance_data: {}
};

describe('buyPerp — loadGame repairs stuck buy_perp goal', () => {
  it('marks buy_perp goal complete when target node is already owned at load time', async () => {
    setState(Object.assign(mkBuyPerpState(), {
      active_missions: ['mission007'],
      mission_goals: [{
        mission:        'mission007',
        workflow:       'buy_perp',
        target:         'contact001',
        amount:         null,
        position:       1,
        current_amount: 0,
        complete:       false
      }],
      nodes: mkBuyPerpState().nodes.concat([NURSE_NODE])
    }));

    await loadGame();

    const goal = getState().mission_goals.find(
      (g) => g.mission === 'mission007' && g.workflow === 'buy_perp'
    );
    expect(goal).toBeDefined();
    expect(goal.complete).toBe(true);
  });

  it('does not alter buy_perp goals when the target is not yet owned', async () => {
    setState(Object.assign(mkBuyPerpState(), {
      active_missions: ['mission007'],
      mission_goals: [{
        mission:        'mission007',
        workflow:       'buy_perp',
        target:         'contact001',
        amount:         null,
        position:       1,
        current_amount: 0,
        complete:       false
      }]
    }));

    await loadGame();

    const goal = getState().mission_goals.find(
      (g) => g.mission === 'mission007' && g.workflow === 'buy_perp'
    );
    expect(goal).toBeDefined();
    expect(goal.complete).toBe(false);
  });
});

describe('buyPerp — mission activating after nurse already owned seeds goal as complete', () => {
  beforeEach(() => {
    setState(Object.assign(mkBuyPerpState(), {
      active_missions: ['mission006'],
      mission_goals: [
        { mission: 'mission006', workflow: 'buy_powerup', target: 'upgrade001',    amount: null, position: 1, current_amount: 1, complete: true  },
        { mission: 'mission006', workflow: 'buy_powerup', target: 'ad002',         amount: null, position: 2, current_amount: 1, complete: true  },
        { mission: 'mission006', workflow: 'buy_powerup', target: 'teammember020', amount: null, position: 3, current_amount: 0, complete: false }
      ],
      nodes: mkBuyPerpState().nodes.concat([PROJECT_NODE, NURSE_NODE])
    }));
  });

  it('mission007 is added to active_missions after buying the final mission006 powerup', async () => {
    await buyPowerup(PROJECT_NODE.full_path, 0, 'teammember020');
    expect(getState().active_missions).toContain('mission007');
  });

  it('mission007 buy_perp goal is complete because nurse is already owned', async () => {
    await buyPowerup(PROJECT_NODE.full_path, 0, 'teammember020');
    const goal = getState().mission_goals.find(
      (g) => g.mission === 'mission007' && g.workflow === 'buy_perp'
    );
    expect(goal).toBeDefined();
    expect(goal.complete).toBe(true);
  });
});

// ── setLocale ────────────────────────────────────────────────────────────────

describe('setLocale', () => {
  beforeEach(() => setState(mkState()));

  it('resolves with the locale code as result', async () => {
    const data = await setLocale('en');
    expect(data).toEqual({ result: 'en' });
  });

  it('persists "en" locale to state', async () => {
    await setLocale('en');
    const state = getState();
    expect(state.locale).toBe('en');
  });

  it('persists "de" locale to state', async () => {
    await setLocale('de');
    const state = getState();
    expect(state.locale).toBe('de');
  });

  it('invalid locale code is returned but state.locale stays undefined', async () => {
    const data = await setLocale('fr');
    expect(data).toEqual({ result: 'fr' });
    const state = getState();
    expect(state.locale).toBeUndefined();
  });

  it('locale is reflected by getSessionLocale after setLocale', async () => {
    await setLocale('en');
    const data = await getSessionLocale();
    expect(data.result).toBe('en');
  });

  it('switching from de to en is reflected immediately', async () => {
    await setLocale('de');
    await setLocale('en');
    const data = await getSessionLocale();
    expect(data.result).toBe('en');
  });
});

// ── getSessionLocale — persisted value ──────────────────────────────────────

describe('getSessionLocale — persisted locale', () => {
  it('returns "en" when state.locale is "en"', async () => {
    setState(mkState({ locale: 'en' }));
    const data = await getSessionLocale();
    expect(data.result).toBe('en');
  });

  it('returns "de" when state.locale is "de"', async () => {
    setState(mkState({ locale: 'de' }));
    const data = await getSessionLocale();
    expect(data.result).toBe('de');
  });

  it('falls back to "de" when state has no locale', async () => {
    setState(mkState());
    const data = await getSessionLocale();
    expect(data.result).toBe('de');
  });
});

// ── dismissMissionBriefing ──────────────────────────────────────────────────

describe('dismissMissionBriefing — happy path', () => {
  beforeEach(() => setState(mkState()));

  it('resolves to {result: {ok: true}}', async () => {
    const data = await dismissMissionBriefing('mission002');
    expect(data).toEqual({ result: { ok: true } });
  });

  it('records the gestalt under state.mission_briefings_seen', async () => {
    await dismissMissionBriefing('mission002');
    expect(getState().mission_briefings_seen).toEqual({ mission002: true });
  });

  it('is idempotent — re-dispatching the same gestalt does not throw', async () => {
    await dismissMissionBriefing('mission002');
    const data = await dismissMissionBriefing('mission002');
    expect(data).toEqual({ result: { ok: true } });
    expect(getState().mission_briefings_seen).toEqual({ mission002: true });
  });

  it('accumulates multiple dismissals', async () => {
    await dismissMissionBriefing('mission002');
    await dismissMissionBriefing('mission003');
    expect(getState().mission_briefings_seen).toEqual({
      mission002: true,
      mission003: true
    });
  });
});

describe('dismissMissionBriefing — failure modes', () => {
  beforeEach(() => setState(mkState()));

  it('returns error 0 for empty string gestalt', async () => {
    const data = await dismissMissionBriefing('');
    expect(data).toEqual({ result: { error: 0 } });
    expect(getState().mission_briefings_seen).toEqual({});
  });

  it('returns error 0 for non-string gestalt', async () => {
    const data = await dismissMissionBriefing(42);
    expect(data).toEqual({ result: { error: 0 } });
  });

  it('returns error 0 for undefined gestalt', async () => {
    const data = await dismissMissionBriefing();
    expect(data).toEqual({ result: { error: 0 } });
  });
});

// ── dismissMissionBriefing — round-trip / reload-guard tests (issue #83) ────

describe('dismissMissionBriefing — reload guard (issue #83)', () => {
  // Happy path: dismiss → loadGame response carries the seen flag so that
  // makeNotifications' seenBriefings guard returns false (don't show).
  it('loadGame response includes mission_briefings_seen after dismiss', async () => {
    setState(mkState());
    await dismissMissionBriefing('mission001');
    const { result } = await loadGame();
    expect(result.mission_briefings_seen).toEqual({ mission001: true });
  });

  // Replay-from-zero: applying the dismiss delta to a freshState produces a
  // state where loadGame also carries the seen flag — the flag survives a cold
  // restart that replays history from serial 0.
  it('dismiss delta replayed from fresh state keeps briefing closed', async () => {
    const addr = 'test@local';
    const dismissDelta = {
      kind: 'delta',
      addr,
      op: 'dismissMissionBriefing',
      args: ['mission001'],
      result: {},
      ts: Date.now()
    };
    const replayed = applyDelta(freshState(addr), dismissDelta);
    setState(replayed);
    const { result } = await loadGame();
    expect(result.mission_briefings_seen).toEqual({ mission001: true });
  });

  // Reload mid-briefing: player reloaded before dismissing — loadGame response
  // must NOT have the flag so the briefing correctly reopens.
  it('no dismiss delta → loadGame response has no seen flag for the gestalt', async () => {
    setState(mkState());
    const { result } = await loadGame();
    expect(result.mission_briefings_seen).toEqual({});
  });
});

// ── markTokenSeen ───────────────────────────────────────────────────────────

describe('markTokenSeen — happy path', () => {
  beforeEach(() => setState(mkState()));

  it('resolves to {result: {ok: true}}', async () => {
    const data = await markTokenSeen('token008');
    expect(data).toEqual({ result: { ok: true } });
  });

  it('records the gestalt under state.tokens_seen', async () => {
    await markTokenSeen('token008');
    expect(getState().tokens_seen).toEqual({ token008: true });
  });

  it('is idempotent', async () => {
    await markTokenSeen('token008');
    const data = await markTokenSeen('token008');
    expect(data).toEqual({ result: { ok: true } });
    expect(getState().tokens_seen).toEqual({ token008: true });
  });

  it('accumulates multiple gestalts', async () => {
    await markTokenSeen('token001');
    await markTokenSeen('token008');
    expect(getState().tokens_seen).toEqual({ token001: true, token008: true });
  });
});

describe('markTokenSeen — failure modes', () => {
  beforeEach(() => setState(mkState()));

  it('returns error 0 for empty string gestalt', async () => {
    const data = await markTokenSeen('');
    expect(data).toEqual({ result: { error: 0 } });
    expect(getState().tokens_seen).toEqual({});
  });

  it('returns error 0 for non-string gestalt', async () => {
    const data = await markTokenSeen(42);
    expect(data).toEqual({ result: { error: 0 } });
  });

  it('returns error 0 for undefined gestalt', async () => {
    const data = await markTokenSeen();
    expect(data).toEqual({ result: { error: 0 } });
  });
});
