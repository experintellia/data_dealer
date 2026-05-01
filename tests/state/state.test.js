import { describe, it, expect } from 'vitest';
import { freshState, applyDelta, SCHEMA_VERSION } from '../../scripts/state.js';

// Required acceptance criteria from issue #10:
//   A. Two divergent replay sequences with the same delta-set converge to identical state.
//   B. Schema-version mismatch handled gracefully.

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
    expect(s.game_values.cash_value).toBe(270);
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

describe('applyDelta — schema-version mismatch (acceptance criterion B)', () => {
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
    const result = applyDelta(s, makeDelta(addr, 'ping', 1000));
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
    expect(applyDelta(s, { kind: 'snapshot', op: 'ping' })).toBe(s);
  });

  it('returns state unchanged for unknown op (after clock guard update)', () => {
    const s = freshState('alice@example.com');
    const result = applyDelta(s, { kind: 'delta', addr: s.addr, op: 'unknownOp9999', ts: 0 });
    expect(result.schema_version).toBe(SCHEMA_VERSION);
    expect(result.nodes).toEqual(s.nodes);
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

});

// ---------------------------------------------------------------------------
// dismissMissionBriefing reducer
// ---------------------------------------------------------------------------

describe('applyDelta — dismissMissionBriefing reducer', () => {
  const addr = 'alice@example.com';

  function makeDismissDelta(addr, gestalt, ts) {
    return { kind: 'delta', addr, op: 'dismissMissionBriefing', args: [gestalt], ts: ts || Date.now() };
  }

  it('freshState seeds mission_briefings_seen as an empty object', () => {
    expect(freshState(addr).mission_briefings_seen).toEqual({});
  });

  it('records the dismissed gestalt under mission_briefings_seen', () => {
    const s = freshState(addr);
    const result = applyDelta(s, makeDismissDelta(addr, 'mission002'));
    expect(result.mission_briefings_seen).toEqual({ mission002: true });
  });

  it('is idempotent — second dispatch leaves mission_briefings_seen unchanged', () => {
    let s = freshState(addr);
    s = applyDelta(s, makeDismissDelta(addr, 'mission002', 1000));
    const result = applyDelta(s, makeDismissDelta(addr, 'mission002', 2000));
    expect(result.mission_briefings_seen).toBe(s.mission_briefings_seen);
  });

  it('accumulates multiple gestalts', () => {
    let s = freshState(addr);
    s = applyDelta(s, makeDismissDelta(addr, 'mission002', 1000));
    s = applyDelta(s, makeDismissDelta(addr, 'mission003', 2000));
    expect(s.mission_briefings_seen).toEqual({ mission002: true, mission003: true });
  });

  it('leaves mission_briefings_seen empty when args is missing', () => {
    const s = freshState(addr);
    const bad = { kind: 'delta', addr, op: 'dismissMissionBriefing', ts: 1000 };
    const result = applyDelta(s, bad);
    expect(result.mission_briefings_seen).toEqual({});
  });

  it('leaves mission_briefings_seen empty when gestalt is empty string', () => {
    const s = freshState(addr);
    const result = applyDelta(s, makeDismissDelta(addr, ''));
    expect(result.mission_briefings_seen).toEqual({});
  });

  it('leaves mission_briefings_seen empty when gestalt is non-string', () => {
    const s = freshState(addr);
    expect(applyDelta(s, makeDismissDelta(addr, 42)).mission_briefings_seen).toEqual({});
    expect(applyDelta(s, makeDismissDelta(addr, null)).mission_briefings_seen).toEqual({});
  });

});

// ---------------------------------------------------------------------------
// markTokenSeen reducer
// ---------------------------------------------------------------------------

describe('applyDelta — markTokenSeen reducer', () => {
  const addr = 'alice@example.com';

  function makeSeenDelta(addr, gestalt, ts) {
    return { kind: 'delta', addr, op: 'markTokenSeen', args: [gestalt], ts: ts || Date.now() };
  }

  it('freshState seeds tokens_seen as an empty object', () => {
    expect(freshState(addr).tokens_seen).toEqual({});
  });

  it('records the seen gestalt under tokens_seen', () => {
    const s = freshState(addr);
    const result = applyDelta(s, makeSeenDelta(addr, 'token008'));
    expect(result.tokens_seen).toEqual({ token008: true });
  });

  it('is idempotent — second dispatch leaves tokens_seen unchanged', () => {
    let s = freshState(addr);
    s = applyDelta(s, makeSeenDelta(addr, 'token008', 1000));
    const result = applyDelta(s, makeSeenDelta(addr, 'token008', 2000));
    expect(result.tokens_seen).toBe(s.tokens_seen);
  });

  it('accumulates multiple gestalts', () => {
    let s = freshState(addr);
    s = applyDelta(s, makeSeenDelta(addr, 'token001', 1000));
    s = applyDelta(s, makeSeenDelta(addr, 'token008', 2000));
    expect(s.tokens_seen).toEqual({ token001: true, token008: true });
  });

  it('leaves tokens_seen empty when args is missing', () => {
    const s = freshState(addr);
    const bad = { kind: 'delta', addr, op: 'markTokenSeen', ts: 1000 };
    expect(applyDelta(s, bad).tokens_seen).toEqual({});
  });

  it('leaves tokens_seen empty when gestalt is empty or non-string', () => {
    const s = freshState(addr);
    expect(applyDelta(s, makeSeenDelta(addr, '')).tokens_seen).toEqual({});
    expect(applyDelta(s, makeSeenDelta(addr, 42)).tokens_seen).toEqual({});
  });

});
