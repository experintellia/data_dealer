import { describe, it, expect } from 'vitest';
import { freshState, applyDelta, SCHEMA_VERSION } from '../../scripts/state.js';

// Required acceptance criteria from issue #10:
//   A. Two divergent replay sequences with the same delta-set converge to identical state.
//   B. Reset op wipes prior state.
//   C. Schema-version mismatch handled gracefully.

function replay(deltas, addr) {
  return deltas.reduce((s, d) => applyDelta(s, d), freshState(addr));
}

function makeDelta(addr, op, ts) {
  return { kind: 'delta', addr, op, args: [], result: {}, ts: ts || Date.now() };
}

describe('freshState', () => {
  it('sets schema_version = SCHEMA_VERSION', () => {
    expect(freshState('alice@example.com').schema_version).toBe(SCHEMA_VERSION);
  });

  it('stores selfAddr as state.addr', () => {
    expect(freshState('alice@example.com').addr).toBe('alice@example.com');
  });

  it('seeds game_values from data/default_game.json', () => {
    const s = freshState('alice@example.com');
    expect(s.game_values.cash_value).toBe(300);
    expect(s.game_values.karma_value).toBe(50);
    expect(s.game_values.xp_level).toBe(1);
    expect(s.game_values.ap_snapshot).toBe(6);
    expect(s.game_values.profiles_max).toBe(1);
  });

  it('initialises transient collection fields to empty arrays', () => {
    const s = freshState('alice@example.com');
    expect(s.nodes_charging).toEqual([]);
    expect(s.nodes_collect).toEqual([]);
    expect(s.db_queue).toEqual([]);
    expect(s.mission_goals).toEqual([]);
  });

  it('seeds starting equipment from data/default_game.json', () => {
    const s = freshState('alice@example.com');
    expect(s.nodes.map((n) => n.gestalt)).toEqual(['database001']);
    expect(s.nodes[0].full_path).toBe('Imperium.database001');
    expect(s.nodes[0].game_id).toBe('database001');
    expect(s.active_missions).toEqual(['mission001']);
  });

  it('accepts a custom seed overriding game_values', () => {
    const seed = { game_values: { cash_value: 9999, xp_level: 5 } };
    const s = freshState('alice@example.com', seed);
    expect(s.game_values.cash_value).toBe(9999);
    expect(s.game_values.xp_level).toBe(5);
  });

  it('works with no arguments', () => {
    const s = freshState();
    expect(s.schema_version).toBe(SCHEMA_VERSION);
    expect(s.addr).toBe('');
  });
});

describe('applyDelta — convergence (acceptance criterion A)', () => {
  const addr = 'alice@example.com';

  it('reordering stub ops produces identical state', () => {
    const d1 = makeDelta(addr, 'buyKarma', 1000);
    const d2 = makeDelta(addr, 'chargePerp', 2000);
    const d3 = makeDelta(addr, 'setPerpCoordinates', 3000);

    const stateA = replay([d1, d2, d3], addr);
    const stateB = replay([d2, d1, d3], addr);
    const stateC = replay([d3, d2, d1], addr);

    expect(stateA.nodes).toEqual(stateB.nodes);
    expect(stateA.nodes).toEqual(stateC.nodes);
    expect(stateA.game_values).toEqual(stateB.game_values);
    expect(stateA.game_values).toEqual(stateC.game_values);
    expect(stateA.active_missions).toEqual(stateB.active_missions);
    expect(stateA.schema_version).toBe(stateB.schema_version);
  });

  it('same delta-set applied to two independent starting states converges', () => {
    const deltas = [
      makeDelta(addr, 'buyKarma', 1000),
      makeDelta(addr, 'chargePerp', 2000),
      makeDelta(addr, 'buyPerp', 3000),
    ];

    const instance1 = replay(deltas, addr);
    const instance2 = replay(deltas, addr);

    expect(instance1.nodes).toEqual(instance2.nodes);
    expect(instance1.game_values).toEqual(instance2.game_values);
    expect(instance1.active_missions).toEqual(instance2.active_missions);
  });
});

describe('applyDelta — reset op (acceptance criterion B)', () => {
  const addr = 'alice@example.com';

  it('wipes player progress and re-seeds starting equipment after reset', () => {
    let s = freshState(addr);
    s = {
      ...s,
      nodes: s.nodes.concat([{ game_type: 'ContactPerp', full_path: 'Imperium.Contact1' }]),
      active_missions: ['mission_x', 'mission_y'],
      mission_goals: [{ goal_id: 'g1', amount: 10, current_amount: 5 }],
    };

    const after = applyDelta(s, makeDelta(addr, 'reset', 5000));

    // Player-bought node gone, seed nodes restored
    expect(after.nodes.map((n) => n.gestalt)).toEqual(['database001']);
    expect(after.active_missions).toEqual(['mission001']);
    expect(after.mission_goals).toEqual([]);
  });

  it('restores game_values to seed defaults after reset', () => {
    let s = freshState(addr);
    s = { ...s, game_values: { ...s.game_values, cash_value: 99999, xp_level: 10 } };

    const after = applyDelta(s, makeDelta(addr, 'reset', 5000));

    expect(after.game_values.cash_value).toBe(300);
    expect(after.game_values.xp_level).toBe(1);
  });

  it('preserves addr after reset (identity must survive wipe)', () => {
    const s = freshState(addr);
    const after = applyDelta(s, makeDelta(addr, 'reset', 5000));
    expect(after.addr).toBe(addr);
  });

  it('preserves schema_version after reset', () => {
    const s = freshState(addr);
    const after = applyDelta(s, makeDelta(addr, 'reset', 5000));
    expect(after.schema_version).toBe(SCHEMA_VERSION);
  });

  it('multiple resets are idempotent', () => {
    let s = freshState(addr);
    const r1 = applyDelta(s, makeDelta(addr, 'reset', 1000));
    const r2 = applyDelta(r1, makeDelta(addr, 'reset', 2000));
    expect(r2.nodes).toEqual(r1.nodes);
    expect(r2.game_values.cash_value).toBe(r1.game_values.cash_value);
  });
});

describe('applyDelta — schema-version mismatch (acceptance criterion C)', () => {
  const addr = 'alice@example.com';

  it('resets to valid fresh state when schema_version is a future value', () => {
    const futureState = {
      ...freshState(addr),
      schema_version: 99,
      nodes: [{ game_type: 'ContactPerp', full_path: 'Imperium.Contact1' }],
      active_missions: ['m_stale'],
    };

    const result = applyDelta(futureState, makeDelta(addr, 'buyKarma', 1000));

    expect(result.schema_version).toBe(SCHEMA_VERSION);
    // Schema-mismatch reset re-seeds the starter equipment, same as a normal reset.
    expect(result.nodes.map((n) => n.gestalt)).toEqual(['database001']);
    expect(result.active_missions).toEqual(['mission001']);
    expect(result.addr).toBe(addr);
  });

  it('resets to valid fresh state when schema_version is an older value', () => {
    const oldState = { ...freshState(addr), schema_version: 0 };
    const result = applyDelta(oldState, makeDelta(addr, 'buyPerp', 1000));
    expect(result.schema_version).toBe(SCHEMA_VERSION);
  });

  it('does not crash on reset op when schema_version mismatches', () => {
    const badState = { ...freshState(addr), schema_version: 999 };
    expect(() => applyDelta(badState, makeDelta(addr, 'reset', 1000))).not.toThrow();
  });
});

describe('applyDelta — other-peer filter', () => {
  it('ignores deltas whose addr differs from state.addr', () => {
    const s = freshState('alice@example.com');
    const foreignDelta = makeDelta('bob@example.com', 'buyKarma', 1000);
    const result = applyDelta(s, foreignDelta);
    expect(result).toBe(s);
  });

  it('processes own-addr deltas normally', () => {
    const addr = 'alice@example.com';
    const s = freshState(addr);
    const result = applyDelta(s, makeDelta(addr, 'reset', 1000));
    expect(result).not.toBe(s);
    expect(result.schema_version).toBe(SCHEMA_VERSION);
  });
});

describe('applyDelta — malformed delta guard', () => {
  it('returns state unchanged for null', () => {
    const s = freshState('alice@example.com');
    expect(applyDelta(s, null)).toBe(s);
  });

  it('returns state unchanged for wrong kind', () => {
    const s = freshState('alice@example.com');
    expect(applyDelta(s, { kind: 'snapshot', op: 'reset' })).toBe(s);
  });

  it('returns state unchanged for unknown op (after clock guard update)', () => {
    const s = freshState('alice@example.com');
    const result = applyDelta(s, { kind: 'delta', addr: s.addr, op: 'unknownOp9999', ts: 0 });
    expect(result.schema_version).toBe(SCHEMA_VERSION);
    expect(result.nodes).toEqual(s.nodes);
  });
});

describe('applyDelta — reset replay semantics (issue #20)', () => {
  const addr = 'alice@example.com';

  it('reset + ops produces same game state as a fresh start + same ops', () => {
    // Pre-reset ops (stubs): their effect on state is wiped by reset.
    const preOps = [
      makeDelta(addr, 'buyKarma', 1000),
      makeDelta(addr, 'chargePerp', 2000),
    ];
    const postOp = makeDelta(addr, 'buyPerp', 4000);

    const viaReset = replay([...preOps, makeDelta(addr, 'reset', 3000), postOp], addr);
    const viaFresh  = replay([postOp], addr);

    // Game-meaningful fields must be identical; last_seen_ts may differ.
    expect(viaReset.nodes).toEqual(viaFresh.nodes);
    expect(viaReset.game_values).toEqual(viaFresh.game_values);
    expect(viaReset.active_missions).toEqual(viaFresh.active_missions);
    expect(viaReset.addr).toBe(viaFresh.addr);
  });

  it('replay-through-reset discards prior history', () => {
    // Any ops before the reset delta must not survive into post-reset state.
    const withHistory = replay([
      makeDelta(addr, 'buyKarma', 1000),
      makeDelta(addr, 'collectPerp', 2000),
      makeDelta(addr, 'reset', 3000),
    ], addr);

    // Reset rebuilds from freshState, which includes the seeded starting
    // equipment + trunk mission — only the player's *progress* is wiped.
    const baseline = freshState(addr);
    expect(withHistory.nodes).toEqual(baseline.nodes);
    expect(withHistory.mission_goals).toEqual([]);
    expect(withHistory.active_missions).toEqual(baseline.active_missions);
    // game_values restored to seed defaults
    expect(withHistory.game_values.cash_value).toBe(300);
    expect(withHistory.game_values.xp_level).toBe(1);
  });
});

describe('applyDelta — clock-skew guard', () => {
  it('last_seen_ts never decreases', () => {
    const addr = 'alice@example.com';
    const futureTs = Date.now() + 1_000_000;
    const s = { ...freshState(addr), last_seen_ts: futureTs };
    const result = applyDelta(s, makeDelta(addr, 'ping', 1));
    expect(result.last_seen_ts).toBeGreaterThanOrEqual(futureTs);
  });

  it('last_seen_ts advances from 0 after first delta', () => {
    const addr = 'alice@example.com';
    const s = freshState(addr);
    expect(s.last_seen_ts).toBe(0);
    const result = applyDelta(s, makeDelta(addr, 'ping', Date.now()));
    expect(result.last_seen_ts).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// setLocale reducer
// ---------------------------------------------------------------------------

describe('applyDelta — setLocale reducer', () => {
  const addr = 'alice@example.com';

  function makeLocaleDelta(addr, locale, ts) {
    return { kind: 'delta', addr, op: 'setLocale', locale, ts: ts || Date.now() };
  }

  it('stores "de" locale on state', () => {
    const s = freshState(addr);
    const result = applyDelta(s, makeLocaleDelta(addr, 'de'));
    expect(result.locale).toBe('de');
  });

  it('stores "en" locale on state', () => {
    const s = freshState(addr);
    const result = applyDelta(s, makeLocaleDelta(addr, 'en'));
    expect(result.locale).toBe('en');
  });

  it('ignores invalid locale codes', () => {
    const s = freshState(addr);
    const result = applyDelta(s, makeLocaleDelta(addr, 'fr'));
    expect(result.locale).toBeUndefined();
  });

  it('overwrites a previously set locale', () => {
    let s = freshState(addr);
    s = applyDelta(s, makeLocaleDelta(addr, 'de', 1000));
    const result = applyDelta(s, makeLocaleDelta(addr, 'en', 2000));
    expect(result.locale).toBe('en');
  });

  it('reset preserves locale across wipe', () => {
    let s = freshState(addr);
    s = applyDelta(s, makeLocaleDelta(addr, 'en', 1000));
    const after = applyDelta(s, makeDelta(addr, 'reset', 2000));
    expect(after.locale).toBe('en');
  });

  it('locale survives replay: setLocale then reset then setLocale', () => {
    const deltas = [
      makeLocaleDelta(addr, 'de', 1000),
      makeDelta(addr, 'reset', 2000),
      makeLocaleDelta(addr, 'en', 3000),
    ];
    const result = replay(deltas, addr);
    expect(result.locale).toBe('en');
  });
});
