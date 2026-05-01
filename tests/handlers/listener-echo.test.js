/**
 * Listener-echo idempotence tests (issue #119 bug class).
 *
 * In production webxdc, the realtime channel echoes a sender's own update
 * back into the listener registered by boot.js. The listener applies the
 * delta through the reducer in scripts/state.js. Handlers that have already
 * called setState(newState) directly will then see the SAME mutation applied
 * a second time on top of the post-handler state.
 *
 * Reducers using INCREMENTAL math (e.g. cash_value: gv.cash_value - cashDelta)
 * double-deduct on self-echo. Reducers that apply a full snapshot via
 * Object.assign({}, state.game_values, r.game_values) are idempotent — the
 * second application overwrites identical values with the same numbers.
 *
 * Status of each reducer in scripts/state.js (as of this commit):
 *
 *   chargePerp         — INCREMENTAL math on cash_value/cash_spent/xp/ap.
 *                         BUGGY: double-deducts on echo. (PR #119 reproduces this.)
 *
 *   buyKarma           — Snapshot-style: Object.assign(gv, r.game_values).
 *                         Echo-safe IFF the delta carries the full post-handler
 *                         game_values. Regression guard.
 *
 *   buyPerp            — Snapshot-style for game_values, but ALSO bumps
 *                         node_counter += 1 every replay → COUNTER doubles
 *                         on echo. Tests below assert game_values stay stable;
 *                         node_counter caveat is called out in the test body.
 *
 *   collectPerp        — Snapshot-style for game_values. Echo-safe.
 *                         db_queue and nodes_collect have de-dup guards.
 *                         Regression guard.
 *
 *   integrateCollected — Snapshot-style for game_values. Echo-safe.
 *                         db_queue removal and nodes update are idempotent.
 *                         Regression guard.
 *
 *   buyPowerup/sellPowerup/buySlots — Shared _nodeGvReducer.  Snapshot-style
 *                         via Object.assign({}, state.game_values, res.game_values).
 *                         Echo-safe. Regression guard.
 *
 * Every describe is `describe(...)` so CI stays green. Once Phase 2 of
 * #120 lands the snapshot-based delta convention across all handlers, these
 * tests should be unskipped to lock in the invariant.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  chargePerp, buyKarma, buyPerp, collectPerp, integrateCollected,
  buyPowerup, sellPowerup, buySlots,
  setSendDelta, setEmitter
} from '../../scripts/LocalEngine.js';
import { getState, setState } from '../../scripts/boot.js';
import { freshState, applyDelta } from '../../scripts/state.js';
import { setOverride, clearOverride } from '../../scripts/clock.js';
import { materialize } from '../../scripts/materializer.js';

// ── shared fixtures ─────────────────────────────────────────────────────────

const FIXED_NOW = 1_700_000_000_000;

const ECONOMY_FIELDS = [
  'cash_value', 'cash_spent', 'xp_value',
  'karma_value', 'profiles_value', 'ap_snapshot'
];

function expectEconomyUnchanged(echoed, handlerState) {
  ECONOMY_FIELDS.forEach(function (k) {
    expect(echoed.game_values[k]).toBe(handlerState.game_values[k]);
  });
}

afterEach(() => {
  clearOverride();
  setSendDelta(null);
  setEmitter(null);
});

// ── chargePerp ──────────────────────────────────────────────────────────────
// chargePerp's reducer uses incremental math:
//   cash_value: gv.cash_value - cashDelta
//   cash_spent: gv.cash_spent + cashDelta
//   xp_value:   gv.xp_value   + xpInc
//   ap_snapshot: max(0, gv.ap_snapshot - 1)
// When the listener echoes the own delta back, this re-applies on top of the
// already-deducted state — KNOWN bug from PR #119.

const CHARGE_GESTALT  = 'contact035';
const CHARGE_TIME     = 30_000;
const CHARGE_COST     = 60;
const CHARGE_PATH     = 'Imperium.CityVienna.Agent0.contact035';

function mkChargeNode() {
  return {
    game_id:       'node-abc123',
    game_type:     'ContactPerp',
    full_path:     CHARGE_PATH,
    full_type:     'ContactPerp:' + CHARGE_GESTALT,
    gestalt:       CHARGE_GESTALT,
    instance_data: {},
  };
}

const CHARGE_BASE_GV = {
  cash_value:      500,
  cash_spent:      0,
  xp_value:        0,
  ap_snapshot:     3,
  ap_update:       FIXED_NOW,
  ap_inc_value:    1,
  ap_inc_interval: 120_000,
  ap_max:          6,
};

function mkChargeState(overrides) {
  overrides = overrides || {};
  var base = freshState('test@local');
  var gv = Object.assign({}, base.game_values, CHARGE_BASE_GV, overrides.game_values || {});
  return Object.assign({}, base, { nodes: [mkChargeNode()] }, overrides, { game_values: gv });
}

describe('chargePerp — listener echo idempotence', () => {
  beforeEach(() => setOverride(FIXED_NOW));

  it('listener echo does not double-deduct cash_value', async () => {
    const captured = [];
    setSendDelta(d => captured.push(d));
    setState(mkChargeState());

    await chargePerp('tok', CHARGE_PATH);
    const handlerState = getState();
    const echoed = applyDelta(handlerState, captured[0]);

    expect(echoed.game_values.cash_value).toBe(handlerState.game_values.cash_value);
  });

  it('listener echo does not double-add cash_spent', async () => {
    const captured = [];
    setSendDelta(d => captured.push(d));
    setState(mkChargeState());

    await chargePerp('tok', CHARGE_PATH);
    const handlerState = getState();
    const echoed = applyDelta(handlerState, captured[0]);

    expect(echoed.game_values.cash_spent).toBe(handlerState.game_values.cash_spent);
  });

  it('listener echo does not double-decrement ap_snapshot', async () => {
    const captured = [];
    setSendDelta(d => captured.push(d));
    setState(mkChargeState());

    await chargePerp('tok', CHARGE_PATH);
    const handlerState = getState();
    const echoed = applyDelta(handlerState, captured[0]);

    expect(echoed.game_values.ap_snapshot).toBe(handlerState.game_values.ap_snapshot);
  });

  it('listener echo does not double-add xp_value', async () => {
    const captured = [];
    setSendDelta(d => captured.push(d));
    setState(mkChargeState());

    await chargePerp('tok', CHARGE_PATH);
    const handlerState = getState();
    const echoed = applyDelta(handlerState, captured[0]);

    expect(echoed.game_values.xp_value).toBe(handlerState.game_values.xp_value);
  });

  it('all economy fields stable across echo', async () => {
    const captured = [];
    setSendDelta(d => captured.push(d));
    setState(mkChargeState());

    await chargePerp('tok', CHARGE_PATH);
    const handlerState = getState();
    const echoed = applyDelta(handlerState, captured[0]);

    expectEconomyUnchanged(echoed, handlerState);
  });
});

// ── buyKarma ────────────────────────────────────────────────────────────────
// Reducer applies Object.assign({}, state.game_values, delta.result.game_values).
// Already echo-safe IF the delta carries the full snapshot. Regression guard.

const KARMA_GESTALT = 'karma001';

function mkKarmaState() {
  var base = freshState('test@local');
  return Object.assign({}, base, {
    game_values: Object.assign({}, base.game_values, {
      xp_value: 1, xp_level: 1, cash_value: 1000, cash_spent: 0,
      karma_value: 50, profiles_value: 0, profiles_max: 1,
      ap_snapshot: 6, ap_update: null
    })
  });
}

describe('buyKarma — listener echo idempotence (regression guard)', () => {
  it('listener echo does not double-deduct cash_value', async () => {
    const captured = [];
    setSendDelta(d => captured.push(d));
    setState(mkKarmaState());

    await buyKarma('tok', KARMA_GESTALT);
    const handlerState = getState();
    const echoed = applyDelta(handlerState, captured[0]);

    expect(echoed.game_values.cash_value).toBe(handlerState.game_values.cash_value);
    expect(echoed.game_values.cash_spent).toBe(handlerState.game_values.cash_spent);
  });

  it('listener echo does not double-add karma_value', async () => {
    const captured = [];
    setSendDelta(d => captured.push(d));
    setState(mkKarmaState());

    await buyKarma('tok', KARMA_GESTALT);
    const handlerState = getState();
    const echoed = applyDelta(handlerState, captured[0]);

    expect(echoed.game_values.karma_value).toBe(handlerState.game_values.karma_value);
  });

  it('all economy fields stable across echo', async () => {
    const captured = [];
    setSendDelta(d => captured.push(d));
    setState(mkKarmaState());

    await buyKarma('tok', KARMA_GESTALT);
    const handlerState = getState();
    const echoed = applyDelta(handlerState, captured[0]);

    expectEconomyUnchanged(echoed, handlerState);
  });
});

// ── buyPerp ─────────────────────────────────────────────────────────────────
// Reducer replaces game_values wholesale (r.game_values || state.game_values),
// so game_values are echo-safe. NOTE: node_counter is incremented by 1 every
// replay; this means an echo will double-bump node_counter. That is a separate
// bug class (counter drift) — these tests focus on game_values + nodes/db_queue
// length. node_counter behavior is intentionally NOT asserted here.

function mkBuyPerpState(overrides) {
  return Object.assign(freshState('buyer@local'), {
    game_values: {
      xp_value: 15, xp_level: 3,
      cash_value: 10000, cash_spent: 0,
      karma_value: 0, profiles_value: 0, profiles_max: 1,
      ap_snapshot: 6, ap_update: null
    }
  }, overrides || {});
}

describe('buyPerp — listener echo idempotence (regression guard)', () => {
  it('listener echo does not double-deduct cash on a successful buy', async () => {
    const captured = [];
    setSendDelta(d => captured.push(d));
    setState(mkBuyPerpState());

    await buyPerp('tok', 'Imperium', 'contact001');
    const handlerState = getState();
    const echoed = applyDelta(handlerState, captured[0]);

    expect(echoed.game_values.cash_value).toBe(handlerState.game_values.cash_value);
    expect(echoed.game_values.cash_spent).toBe(handlerState.game_values.cash_spent);
    expect(echoed.game_values.xp_value).toBe(handlerState.game_values.xp_value);
  });

  it('listener echo does not double-grow nodes array (de-dup by full_path)', async () => {
    const captured = [];
    setSendDelta(d => captured.push(d));
    setState(mkBuyPerpState());

    await buyPerp('tok', 'Imperium', 'contact001');
    const handlerState = getState();
    const echoed = applyDelta(handlerState, captured[0]);

    expect(echoed.nodes.length).toBe(handlerState.nodes.length);
  });

  it('listener echo does not double-grow db_queue for contact gestalt', async () => {
    const captured = [];
    setSendDelta(d => captured.push(d));
    setState(mkBuyPerpState());

    await buyPerp('tok', 'Imperium', 'contact001');
    const handlerState = getState();
    const echoed = applyDelta(handlerState, captured[0]);

    expect(echoed.db_queue.length).toBe(handlerState.db_queue.length);
  });

  it('all economy fields stable across echo', async () => {
    const captured = [];
    setSendDelta(d => captured.push(d));
    setState(mkBuyPerpState());

    await buyPerp('tok', 'Imperium', 'contact001');
    const handlerState = getState();
    const echoed = applyDelta(handlerState, captured[0]);

    expectEconomyUnchanged(echoed, handlerState);
  });
});

// ── collectPerp ─────────────────────────────────────────────────────────────
// Reducer applies snapshot-style game_values merge. db_queue and
// nodes_collect have explicit de-dup. Regression guard.

const COLLECT_PATH    = 'Imperium.City.Agent0.contact001';
const COLLECT_DUR     = 120_000;
const COLLECT_END     = FIXED_NOW + COLLECT_DUR;

function mkCollectGv(overrides) {
  return Object.assign({
    xp_value: 5, xp_level: 1,
    karma_value: 50, cash_value: 300, cash_spent: 0,
    profiles_value: 0, profiles_max: 1,
    ap_snapshot: 6, ap_update: FIXED_NOW,
    ap_inc_value: 1, ap_inc_interval: 120000, ap_max: 6
  }, overrides || {});
}

function mkCollectNode(gameType, path) {
  var parts   = path.split('.');
  var gestalt = parts[parts.length - 1];
  return {
    game_id:       'node_' + gestalt,
    game_type:     gameType,
    full_type:     gameType + ':' + gestalt,
    gestalt:       gestalt,
    full_path:     path,
    instance_data: {}
  };
}

function mkChargingEntry(path, result, gameType) {
  var parts   = path.split('.');
  var gestalt = parts[parts.length - 1];
  return {
    path:         path,
    result:       result,
    charge_start: FIXED_NOW - COLLECT_DUR,
    charge_end:   COLLECT_END,
    game_id:      'node_' + gestalt,
    game_type:    gameType
  };
}

describe('collectPerp — listener echo idempotence (regression guard)', () => {
  beforeEach(() => setOverride(FIXED_NOW));

  function setupCharged() {
    var s = Object.assign(freshState('test@local'), {
      game_values:    mkCollectGv(),
      nodes:          [mkCollectNode('ContactPerp', COLLECT_PATH)],
      nodes_charging: [mkChargingEntry(COLLECT_PATH, { amount: 5 }, 'ContactPerp')]
    });
    setState(s);
    // Materialize so nodes_collect has the entry collectPerp expects.
    setOverride(COLLECT_END + 1000);
    var mat = materialize(getState(), COLLECT_END + 1000);
    setState(mat.state);
  }

  it('listener echo does not double-add xp_value or profiles_value', async () => {
    setupCharged();
    const captured = [];
    setSendDelta(d => captured.push(d));

    await collectPerp('tok', COLLECT_PATH);
    const handlerState = getState();
    const echoed = applyDelta(handlerState, captured[0]);

    expect(echoed.game_values.xp_value).toBe(handlerState.game_values.xp_value);
    expect(echoed.game_values.profiles_value).toBe(handlerState.game_values.profiles_value);
  });

  it('listener echo does not double-grow db_queue', async () => {
    setupCharged();
    const captured = [];
    setSendDelta(d => captured.push(d));

    await collectPerp('tok', COLLECT_PATH);
    const handlerState = getState();
    const echoed = applyDelta(handlerState, captured[0]);

    expect(echoed.db_queue.length).toBe(handlerState.db_queue.length);
  });

  it('listener echo does not double-shrink nodes_collect', async () => {
    setupCharged();
    const captured = [];
    setSendDelta(d => captured.push(d));

    await collectPerp('tok', COLLECT_PATH);
    const handlerState = getState();
    const echoed = applyDelta(handlerState, captured[0]);

    expect(echoed.nodes_collect.length).toBe(handlerState.nodes_collect.length);
  });

  it('all economy fields stable across echo', async () => {
    setupCharged();
    const captured = [];
    setSendDelta(d => captured.push(d));

    await collectPerp('tok', COLLECT_PATH);
    const handlerState = getState();
    const echoed = applyDelta(handlerState, captured[0]);

    expectEconomyUnchanged(echoed, handlerState);
  });
});

// ── integrateCollected ──────────────────────────────────────────────────────
// Reducer applies snapshot-style game_values merge. db_queue removal is by
// collect_id filter (idempotent). Regression guard.

describe('integrateCollected — listener echo idempotence (regression guard)', () => {
  beforeEach(() => setOverride(FIXED_NOW));

  async function chargeCollectAndCapture() {
    var s = Object.assign(freshState('test@local'), {
      game_values:    mkCollectGv(),
      nodes:          [mkCollectNode('ContactPerp', COLLECT_PATH)],
      nodes_charging: [mkChargingEntry(COLLECT_PATH, { amount: 5 }, 'ContactPerp')]
    });
    setState(s);
    setOverride(COLLECT_END + 1000);
    var mat = materialize(getState(), COLLECT_END + 1000);
    setState(mat.state);

    const colRes = await collectPerp('tok', COLLECT_PATH);
    return colRes.result.result.collect_id;
  }

  it('listener echo does not double-add profiles_value or xp_value', async () => {
    const collectId = await chargeCollectAndCapture();
    const captured = [];
    setSendDelta(d => captured.push(d));

    await integrateCollected('tok', collectId);
    const handlerState = getState();
    const echoed = applyDelta(handlerState, captured[0]);

    expect(echoed.game_values.profiles_value).toBe(handlerState.game_values.profiles_value);
    expect(echoed.game_values.xp_value).toBe(handlerState.game_values.xp_value);
  });

  it('listener echo does not re-add the entry to db_queue', async () => {
    const collectId = await chargeCollectAndCapture();
    const captured = [];
    setSendDelta(d => captured.push(d));

    await integrateCollected('tok', collectId);
    const handlerState = getState();
    const echoed = applyDelta(handlerState, captured[0]);

    expect(echoed.db_queue.length).toBe(handlerState.db_queue.length);
  });

  it('listener echo does not double-grow nodes (TokenPerp first integration)', async () => {
    const collectId = await chargeCollectAndCapture();
    const captured = [];
    setSendDelta(d => captured.push(d));

    await integrateCollected('tok', collectId);
    const handlerState = getState();
    const echoed = applyDelta(handlerState, captured[0]);

    expect(echoed.nodes.length).toBe(handlerState.nodes.length);
  });

  it('all economy fields stable across echo', async () => {
    const collectId = await chargeCollectAndCapture();
    const captured = [];
    setSendDelta(d => captured.push(d));

    await integrateCollected('tok', collectId);
    const handlerState = getState();
    const echoed = applyDelta(handlerState, captured[0]);

    expectEconomyUnchanged(echoed, handlerState);
  });
});

// ── buyPowerup / sellPowerup / buySlots fixtures ────────────────────────────
// All three share _nodeGvReducer in scripts/state.js, which applies game_values
// via Object.assign({}, state.game_values, res.game_values || {}). Echo-safe
// IFF the delta carries a full snapshot. Regression guards.

var PROJECT_NODE = {
  game_id:       'proj001',
  game_type:     'ProjectPerp',
  full_path:     'Imperium.CityVienna.proj001',
  full_type:     'ProjectPerp:project001',
  gestalt:       'project001',
  instance_data: { x: 100, y: 100, powerups: [] }
};

function mkProjectState(overrides) {
  var base = freshState('test@local');
  return Object.assign({}, base, { nodes: [PROJECT_NODE] }, overrides || {});
}

function mkStateWithPowerup() {
  var nodeWithPu = Object.assign({}, PROJECT_NODE, {
    instance_data: {
      x: 100, y: 100,
      powerups: [{ slot: 0, gestalt: 'ad002', full_type: 'AdPowerup:ad002' }],
      charge_cost:    225,
      collect_amount: 3760,
      collect_risk:   2
    }
  });
  return Object.assign({}, freshState('test@local'), { nodes: [nodeWithPu] });
}

// ── buyPowerup ──────────────────────────────────────────────────────────────

describe('buyPowerup — listener echo idempotence (regression guard)', () => {
  it('listener echo does not double-deduct cash on powerup buy', async () => {
    setState(mkProjectState());
    const captured = [];
    setSendDelta(d => captured.push(d));

    await buyPowerup('tok', PROJECT_NODE.full_path, 0, 'ad002');
    const handlerState = getState();
    const echoed = applyDelta(handlerState, captured[0]);

    expect(echoed.game_values.cash_value).toBe(handlerState.game_values.cash_value);
    expect(echoed.game_values.cash_spent).toBe(handlerState.game_values.cash_spent);
  });

  it('listener echo does not double-add xp_value or karma_value', async () => {
    setState(mkProjectState());
    const captured = [];
    setSendDelta(d => captured.push(d));

    await buyPowerup('tok', PROJECT_NODE.full_path, 0, 'ad002');
    const handlerState = getState();
    const echoed = applyDelta(handlerState, captured[0]);

    expect(echoed.game_values.xp_value).toBe(handlerState.game_values.xp_value);
    expect(echoed.game_values.karma_value).toBe(handlerState.game_values.karma_value);
  });

  it('all economy fields stable across echo', async () => {
    setState(mkProjectState());
    const captured = [];
    setSendDelta(d => captured.push(d));

    await buyPowerup('tok', PROJECT_NODE.full_path, 0, 'ad002');
    const handlerState = getState();
    const echoed = applyDelta(handlerState, captured[0]);

    expectEconomyUnchanged(echoed, handlerState);
  });
});

// ── sellPowerup ─────────────────────────────────────────────────────────────

describe('sellPowerup — listener echo idempotence (regression guard)', () => {
  it('listener echo does not double-refund cash on powerup sell', async () => {
    setState(mkStateWithPowerup());
    const captured = [];
    setSendDelta(d => captured.push(d));

    await sellPowerup('tok', PROJECT_NODE.full_path, 0, 'ad002');
    const handlerState = getState();
    const echoed = applyDelta(handlerState, captured[0]);

    expect(echoed.game_values.cash_value).toBe(handlerState.game_values.cash_value);
  });

  it('listener echo does not double-add xp_value', async () => {
    setState(mkStateWithPowerup());
    const captured = [];
    setSendDelta(d => captured.push(d));

    await sellPowerup('tok', PROJECT_NODE.full_path, 0, 'ad002');
    const handlerState = getState();
    const echoed = applyDelta(handlerState, captured[0]);

    expect(echoed.game_values.xp_value).toBe(handlerState.game_values.xp_value);
  });

  it('all economy fields stable across echo', async () => {
    setState(mkStateWithPowerup());
    const captured = [];
    setSendDelta(d => captured.push(d));

    await sellPowerup('tok', PROJECT_NODE.full_path, 0, 'ad002');
    const handlerState = getState();
    const echoed = applyDelta(handlerState, captured[0]);

    expectEconomyUnchanged(echoed, handlerState);
  });
});

// ── buySlots ────────────────────────────────────────────────────────────────

describe('buySlots — listener echo idempotence (regression guard)', () => {
  it('listener echo does not double-deduct cash on slot purchase', async () => {
    setState(mkProjectState());
    const captured = [];
    setSendDelta(d => captured.push(d));

    await buySlots('tok', PROJECT_NODE.full_path, 'ad', 1);
    const handlerState = getState();
    const echoed = applyDelta(handlerState, captured[0]);

    expect(echoed.game_values.cash_value).toBe(handlerState.game_values.cash_value);
    expect(echoed.game_values.cash_spent).toBe(handlerState.game_values.cash_spent);
  });

  it('listener echo does not double-add xp_value', async () => {
    setState(mkProjectState());
    const captured = [];
    setSendDelta(d => captured.push(d));

    await buySlots('tok', PROJECT_NODE.full_path, 'ad', 1);
    const handlerState = getState();
    const echoed = applyDelta(handlerState, captured[0]);

    expect(echoed.game_values.xp_value).toBe(handlerState.game_values.xp_value);
  });

  it('all economy fields stable across echo', async () => {
    setState(mkProjectState());
    const captured = [];
    setSendDelta(d => captured.push(d));

    await buySlots('tok', PROJECT_NODE.full_path, 'ad', 1);
    const handlerState = getState();
    const echoed = applyDelta(handlerState, captured[0]);

    expectEconomyUnchanged(echoed, handlerState);
  });
});
