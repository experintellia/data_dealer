import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  getToken, ping, getSessionLocale, loadGame, getRanking, setEmitter
} from '../../scripts/LocalEngine.js';
import { setState } from '../../scripts/boot.js';
import { freshState, applyDelta } from '../../scripts/state.js';
import { setOverride, clearOverride } from '../../scripts/clock.js';

// ── fixtures ─────────────────────────────────────────────────────────────────

function mkState(overrides) {
  return Object.assign(freshState('test@local'), overrides || {});
}

// ── getRanking ───────────────────────────────────────────────────────────────

function mkRankingState() {
  var base = mkState();
  return Object.assign({}, base, {
    display_name: 'TestUser',
    game_values: Object.assign({}, base.game_values, {
      xp_value: 77,
      cash_value: 200,
      profiles_value: 3,
      cash_spent: 50
    })
  });
}

describe('getRanking', () => {
  beforeEach(() => setState(mkRankingState()));

  it('returns the single-row shape with user_rank 1', async () => {
    const { result } = await getRanking('tok', 'xp');
    expect(result).toHaveProperty('top');
    expect(result).toHaveProperty('user_rank', 1);
    expect(result.top).toHaveLength(1);
    expect(result.top[0]).toMatchObject({ display_name: 'TestUser', self: true });
  });

  it('xp type returns game_values.xp_value', async () => {
    const { result } = await getRanking('tok', 'xp');
    expect(result.top[0].value).toBe(77);
  });

  it('cash type returns game_values.cash_value', async () => {
    const { result } = await getRanking('tok', 'cash');
    expect(result.top[0].value).toBe(200);
  });

  it('profiles type returns game_values.profiles_value', async () => {
    const { result } = await getRanking('tok', 'profiles');
    expect(result.top[0].value).toBe(3);
  });

  it('spent type returns game_values.cash_spent', async () => {
    const { result } = await getRanking('tok', 'spent');
    expect(result.top[0].value).toBe(50);
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
    const data = await loadGame('tok');
    expect(data).toHaveProperty('result');
  });

  it('result carries all top-level fields Game.js:1876 reads', async () => {
    const { result } = await loadGame('tok');
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
    const { result } = await loadGame('tok');
    expect(typeof result.version).toBe('string');
  });

  it('_id is the selfAddr from state', async () => {
    const { result } = await loadGame('tok');
    expect(result._id).toBe('test@local');
  });

  it('user.auth_username is the selfAddr', async () => {
    const { result } = await loadGame('tok');
    expect(result.user.auth_username).toBe('test@local');
  });

  it('Imperium has required shape', async () => {
    const { result } = await loadGame('tok');
    expect(result.Imperium).toMatchObject({
      game_id: 'Imperium',
      full_path: 'Imperium',
      instance_data: expect.any(Object),
      type_data: expect.any(Object)
    });
  });

  it('Database has required shape', async () => {
    const { result } = await loadGame('tok');
    expect(result.Database).toMatchObject({
      game_id: 'Database',
      full_path: 'Database',
      instance_data: expect.any(Object),
      type_data: expect.any(Object)
    });
  });

  it('server_time is an ExtJSON date object', async () => {
    const { result } = await loadGame('tok');
    expect(result.server_time).toHaveProperty('$date');
    expect(typeof result.server_time.$date).toBe('number');
    expect(result.server_time.$date).toBeGreaterThan(0);
  });

  it('type_registry is a non-empty object', async () => {
    const { result } = await loadGame('tok');
    expect(typeof result.type_registry).toBe('object');
    expect(Object.keys(result.type_registry).length).toBeGreaterThan(0);
  });

  it('type_data includes levels array for getLevelByXP', async () => {
    const { result } = await loadGame('tok');
    expect(Array.isArray(result.type_data.levels)).toBe(true);
    expect(result.type_data.levels.length).toBeGreaterThan(0);
  });

  it('missions is an array', async () => {
    const { result } = await loadGame('tok');
    expect(Array.isArray(result.missions)).toBe(true);
    expect(result.missions.length).toBeGreaterThan(0);
  });

  it('karmalauters and karmalizers are non-empty arrays', async () => {
    const { result } = await loadGame('tok');
    expect(Array.isArray(result.karmalauters)).toBe(true);
    expect(result.karmalauters.length).toBeGreaterThan(0);
    expect(Array.isArray(result.karmalizers)).toBe(true);
    expect(result.karmalizers.length).toBeGreaterThan(0);
  });

  it('is_new_game is true for empty nodes array', async () => {
    const { result } = await loadGame('tok');
    expect(result.is_new_game).toBe(true);
  });

  it('nodes is an array (empty for fresh game)', async () => {
    const { result } = await loadGame('tok');
    expect(Array.isArray(result.nodes)).toBe(true);
  });

  it('game_values inside type_data has ap_initial and ap_offset', async () => {
    const { result } = await loadGame('tok');
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

    const { result } = await loadGame('tok');
    expect(result._id).toBe('player@example');
    expect(result.version).toBeDefined();
  });

  it('is_new_game is false when nodes array is non-empty', async () => {
    var s = freshState('p@x');
    // Manually add a fake node to simulate a returning player.
    s = Object.assign({}, s, {
      nodes: [{ game_id: 'n1', game_type: 'ContactPerp', full_path: 'Imperium.n1', full_type: 'ContactPerp:contact001', instance_data: {} }]
    });
    setState(s);

    const { result } = await loadGame('tok');
    expect(result.is_new_game).toBe(false);
    expect(result.nodes).toHaveLength(1);
  });
});

// ── materialization on boot ───────────────────────────────────────────────────

const FIXED_NOW = 1_700_000_000_000; // 2023-11-14 — stable reference epoch

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

    await loadGame('tok');

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

    await loadGame('tok');

    // After loadGame, the materialised state should have been persisted.
    const { result } = await loadGame('tok');
    // Second call: charge already moved, no further changes expected.
    expect(result.nodes_charging).toHaveLength(0);
    expect(result.nodes_collect).toHaveLength(1);
    expect(result.nodes_collect[0].path).toBe('Imperium.City.contact002');
  });

  it('emits no events when there are no completed charges', async () => {
    const emitted = [];
    setEmitter(function(ev, pl) { emitted.push({ ev, pl }); });

    setState(mkState());
    await loadGame('tok');
    await Promise.resolve();

    expect(emitted).toHaveLength(0);
  });
});
