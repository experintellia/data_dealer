import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  chargePerp, setSendDelta, setEmitter,
} from '../../scripts/LocalEngine.js';
import { getState, setState } from '../../scripts/boot.js';
import { freshState, applyDelta } from '../../scripts/state.js';
import { setOverride, clearOverride } from '../../scripts/clock.js';
import { materialize } from '../../scripts/materializer.js';

// ── fixtures ─────────────────────────────────────────────────────────────────

const FIXED_NOW = 1_700_000_000_000;

// contact035 from ruleset_3.de.json:
//   charge_time:     30000  (30 s)
//   charge_cost:     60
//   collect_amount:  1100
//   xp_inc:          1
//   game_type:       ContactPerp
const GESTALT     = 'contact035';
const CHARGE_TIME = 30_000;
const CHARGE_COST = 60;
const NODE_PATH   = 'Imperium.CityVienna.Agent0.contact035';

function mkNode(instanceOverrides) {
  return {
    game_id:       'node-abc123',
    game_type:     'ContactPerp',
    full_path:     NODE_PATH,
    full_type:     'ContactPerp:' + GESTALT,
    gestalt:       GESTALT,
    instance_data: Object.assign({}, instanceOverrides || {}),
  };
}

var BASE_GV = {
  cash_value:      500,
  cash_spent:      0,
  xp_value:        0,
  ap_snapshot:     3,
  ap_update:       0,
  ap_inc_value:    1,
  ap_inc_interval: 120_000,
  ap_max:          6,
};

function mkState(overrides) {
  overrides = overrides || {};
  var base = freshState('test@local');
  // Deep-merge game_values so partial overrides don't drop AP regen fields.
  var gv = Object.assign({}, base.game_values, BASE_GV, overrides.game_values || {});
  return Object.assign({}, base, { nodes: [mkNode()] }, overrides, { game_values: gv });
}

// Reset injectable hooks after each test.
afterEach(() => {
  clearOverride();
  setSendDelta(null);
  setEmitter(null);
});

// ── happy path ────────────────────────────────────────────────────────────────

describe('chargePerp — happy path', () => {
  beforeEach(() => {
    setOverride(FIXED_NOW);
    setState(mkState());
  });

  it('resolves to an object with result', async () => {
    const data = await chargePerp('tok', NODE_PATH);
    expect(data).toHaveProperty('result');
  });

  it('returns duration from ruleset charge_time', async () => {
    const { result } = await chargePerp('tok', NODE_PATH);
    expect(result.error).toBeUndefined();
    expect(result.duration).toBe(CHARGE_TIME);
  });

  it('returns game_values with cash deducted', async () => {
    const { result } = await chargePerp('tok', NODE_PATH);
    expect(result.game_values.cash_value).toBe(500 - CHARGE_COST);
  });

  it('records cash_spent', async () => {
    const { result } = await chargePerp('tok', NODE_PATH);
    expect(result.game_values.cash_spent).toBe(CHARGE_COST);
  });

  it('decrements ap_snapshot by 1', async () => {
    const { result } = await chargePerp('tok', NODE_PATH);
    expect(result.game_values.ap_snapshot).toBe(2);
  });

  it('increments xp_value by xp_inc from ruleset', async () => {
    const { result } = await chargePerp('tok', NODE_PATH);
    expect(result.game_values.xp_value).toBe(1); // xp_inc=1 for contact035
  });

  it('returns levelup: false (no level logic in phase 3)', async () => {
    const { result } = await chargePerp('tok', NODE_PATH);
    expect(result.levelup).toBe(false);
  });

  it('returns missions (empty object for now)', async () => {
    const { result } = await chargePerp('tok', NODE_PATH);
    expect(result.missions).toBeDefined();
  });

  it('pushes one entry onto nodes_charging in state', async () => {
    await chargePerp('tok', NODE_PATH);
    const s = getState();
    expect(s.nodes_charging).toHaveLength(1);
  });

  it('nodes_charging entry has correct path', async () => {
    await chargePerp('tok', NODE_PATH);
    expect(getState().nodes_charging[0].path).toBe(NODE_PATH);
  });

  it('nodes_charging entry has correct charge_end = now + duration', async () => {
    await chargePerp('tok', NODE_PATH);
    const entry = getState().nodes_charging[0];
    expect(entry.charge_end).toBe(FIXED_NOW + CHARGE_TIME);
  });

  it('nodes_charging entry has correct charge_start', async () => {
    await chargePerp('tok', NODE_PATH);
    const entry = getState().nodes_charging[0];
    expect(entry.charge_start).toBe(FIXED_NOW);
  });

  it('nodes_charging entry carries a pre-computed result', async () => {
    await chargePerp('tok', NODE_PATH);
    const entry = getState().nodes_charging[0];
    expect(entry.result).toBeDefined();
    expect(typeof entry.result.amount).toBe('number');
  });

  it('pre-computed amount is within ±5% of collect_amount', async () => {
    await chargePerp('tok', NODE_PATH);
    const amount = getState().nodes_charging[0].result.amount;
    expect(amount).toBeGreaterThanOrEqual(Math.round(1100 * 0.95));
    expect(amount).toBeLessThanOrEqual(Math.round(1100 * 1.05));
  });

  it('sets charge_start on the node instance_data', async () => {
    await chargePerp('tok', NODE_PATH);
    const node = getState().nodes[0];
    expect(node.instance_data.charge_start).toBe(FIXED_NOW);
  });

  it('is deterministic: same ts+path produces same amount on repeated calls', async () => {
    // Charge, collect state, reset to initial, charge again — same result.
    await chargePerp('tok', NODE_PATH);
    const amount1 = getState().nodes_charging[0].result.amount;

    // Reset and re-run with the same clock.
    setState(mkState());
    await chargePerp('tok', NODE_PATH);
    const amount2 = getState().nodes_charging[0].result.amount;
    expect(amount1).toBe(amount2);
  });
});

// ── delta emission & applyDelta replay ───────────────────────────────────────

describe('chargePerp — delta replay', () => {
  beforeEach(() => setOverride(FIXED_NOW));

  it('calls the injected sendDelta function', async () => {
    const captured = [];
    setSendDelta(d => captured.push(d));
    setState(mkState());

    await chargePerp('tok', NODE_PATH);

    expect(captured).toHaveLength(1);
  });

  it('emitted delta has kind=delta and op=chargePerp', async () => {
    const captured = [];
    setSendDelta(d => captured.push(d));
    setState(mkState());

    await chargePerp('tok', NODE_PATH);

    const delta = captured[0];
    expect(delta.kind).toBe('delta');
    expect(delta.op).toBe('chargePerp');
  });

  it('emitted delta carries the charge entry in result', async () => {
    const captured = [];
    setSendDelta(d => captured.push(d));
    setState(mkState());

    await chargePerp('tok', NODE_PATH);

    const { chargeEntry } = captured[0].result;
    expect(chargeEntry).toBeDefined();
    expect(chargeEntry.path).toBe(NODE_PATH);
    expect(chargeEntry.charge_end).toBe(FIXED_NOW + CHARGE_TIME);
  });

  it('applyDelta replay reconstructs the same state as the handler', async () => {
    const captured = [];
    setSendDelta(d => captured.push(d));

    const initial = mkState();
    setState(initial);

    await chargePerp('tok', NODE_PATH);
    const handlerState = getState();

    // Replay delta from scratch.
    const replayed = applyDelta(initial, captured[0]);

    // Core economy fields must match.
    expect(replayed.game_values.cash_value).toBe(handlerState.game_values.cash_value);
    expect(replayed.game_values.cash_spent).toBe(handlerState.game_values.cash_spent);
    expect(replayed.game_values.ap_snapshot).toBe(handlerState.game_values.ap_snapshot);
    expect(replayed.game_values.xp_value).toBe(handlerState.game_values.xp_value);
    // nodes_charging must contain the same entry.
    expect(replayed.nodes_charging).toHaveLength(1);
    expect(replayed.nodes_charging[0]).toEqual(handlerState.nodes_charging[0]);
    // charge_start set on node.
    expect(replayed.nodes[0].instance_data.charge_start)
      .toBe(handlerState.nodes[0].instance_data.charge_start);
  });
});

// ── materialization integration ───────────────────────────────────────────────

describe('chargePerp — materialization integration', () => {
  beforeEach(() => {
    setOverride(FIXED_NOW);
    setState(mkState());
  });

  it('materializer detects a completed charge and emits node_ready', async () => {
    await chargePerp('tok', NODE_PATH);
    const s = getState();

    const mat = materialize(s, FIXED_NOW + CHARGE_TIME + 1);
    expect(mat.events).toHaveLength(1);
    expect(mat.events[0].ev).toBe('node_ready');
    expect(mat.events[0].pl.path).toBe(NODE_PATH);
  });

  it('node_ready event carries the pre-computed charge result', async () => {
    await chargePerp('tok', NODE_PATH);
    const s        = getState();
    const expected = s.nodes_charging[0].result;

    const mat = materialize(s, FIXED_NOW + CHARGE_TIME + 1);
    expect(mat.events[0].pl.result).toEqual(expected);
  });

  it('after materialization the entry moves to nodes_collect', async () => {
    await chargePerp('tok', NODE_PATH);
    const s = getState();

    const mat = materialize(s, FIXED_NOW + CHARGE_TIME + 1);
    expect(mat.state.nodes_charging).toHaveLength(0);
    expect(mat.state.nodes_collect).toHaveLength(1);
    expect(mat.state.nodes_collect[0].path).toBe(NODE_PATH);
  });

  it('materializer emits no event before charge_end', async () => {
    await chargePerp('tok', NODE_PATH);
    const s = getState();

    const mat = materialize(s, FIXED_NOW + CHARGE_TIME - 1);
    expect(mat.events).toHaveLength(0);
    expect(mat.state.nodes_charging).toHaveLength(1);
  });

  it('charge + advance O(1) triggers ready cycle without setTimeout', async () => {
    await chargePerp('tok', NODE_PATH);
    const s = getState();

    // Jump forward an entire day — no setTimeout involved.
    const oneDayMs = 86_400_000;
    const mat = materialize(s, FIXED_NOW + oneDayMs);
    expect(mat.events).toHaveLength(1);
    expect(mat.state.nodes_collect).toHaveLength(1);
  });
});

// ── failure modes ─────────────────────────────────────────────────────────────

describe('chargePerp — failure: insufficient cash', () => {
  it('returns error when cash_value < charge_cost', async () => {
    setOverride(FIXED_NOW);
    setState(mkState({ game_values: { cash_value: CHARGE_COST - 1, ap_snapshot: 3 } }));

    const { result } = await chargePerp('tok', NODE_PATH);
    expect(result.error).toBeDefined();
  });

  it('does not push onto nodes_charging on cash failure', async () => {
    setOverride(FIXED_NOW);
    setState(mkState({ game_values: { cash_value: 0, ap_snapshot: 3 } }));

    await chargePerp('tok', NODE_PATH);
    expect(getState().nodes_charging).toHaveLength(0);
  });

  it('does not call sendDelta on cash failure', async () => {
    setOverride(FIXED_NOW);
    const captured = [];
    setSendDelta(d => captured.push(d));
    setState(mkState({ game_values: { cash_value: 0, ap_snapshot: 3 } }));

    await chargePerp('tok', NODE_PATH);
    expect(captured).toHaveLength(0);
  });
});

describe('chargePerp — failure: insufficient AP', () => {
  it('returns error when ap_snapshot < 1', async () => {
    setOverride(FIXED_NOW);
    setState(mkState({ game_values: { cash_value: 500, ap_snapshot: 0 } }));

    const { result } = await chargePerp('tok', NODE_PATH);
    expect(result.error).toBeDefined();
  });

  it('does not push onto nodes_charging on AP failure', async () => {
    setOverride(FIXED_NOW);
    setState(mkState({ game_values: { cash_value: 500, ap_snapshot: 0 } }));

    await chargePerp('tok', NODE_PATH);
    expect(getState().nodes_charging).toHaveLength(0);
  });
});

describe('chargePerp — failure: perp already charging', () => {
  it('returns error: 2 when the perp is already in nodes_charging', async () => {
    setOverride(FIXED_NOW);
    setState(mkState());

    // First charge — should succeed.
    await chargePerp('tok', NODE_PATH);
    expect(getState().nodes_charging).toHaveLength(1);

    // Second charge on the same perp — should fail.
    const { result } = await chargePerp('tok', NODE_PATH);
    expect(result.error).toBe(2);
  });

  it('does not add a second entry to nodes_charging', async () => {
    setOverride(FIXED_NOW);
    setState(mkState());

    await chargePerp('tok', NODE_PATH);
    await chargePerp('tok', NODE_PATH);
    expect(getState().nodes_charging).toHaveLength(1);
  });
});

describe('chargePerp — failure: node not found', () => {
  it('returns error: 1 for an unknown path', async () => {
    setOverride(FIXED_NOW);
    setState(mkState());

    const { result } = await chargePerp('tok', 'Imperium.NoSuchNode');
    expect(result.error).toBe(1);
  });
});

describe('chargePerp — failure: non-chargeable node (no charge_time)', () => {
  it('returns error: 1 for a node type without charge_time in ruleset', async () => {
    setOverride(FIXED_NOW);
    // Use a StoryPerp gestalt (no charge_time in type_data)
    var nonChargeable = mkNode({});
    nonChargeable = Object.assign({}, nonChargeable, {
      full_path:  'Imperium.story001',
      full_type:  'StoryPerp:13fee24f6edc8f796903e5b1fad001d3000',
      gestalt:    '13fee24f6edc8f796903e5b1fad001d3000',
    });
    var s = mkState({ nodes: [nonChargeable] });
    setState(s);

    const { result } = await chargePerp('tok', 'Imperium.story001');
    expect(result.error).toBe(1);
  });
});
