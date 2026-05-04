// @ts-nocheck — strict-TS quarantine; remove when this file is migrated to TS (issue #147)
import { describe, expect, it } from 'vitest';
import { SCHEMA_VERSION, applyDelta, freshState } from '../../scripts/state.js';

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

describe('applyDelta — chargePerp keys nodes by path', () => {
  const addr = 'alice@example.com';

  it('charges the node matching chargeEntry.path even when nodes are reordered', () => {
    const base = freshState(addr);
    const nodeA = {
      game_id: 'a',
      game_type: 'ContactPerp',
      full_path: 'Imperium.A',
      gestalt: 'a',
      instance_data: {},
    };
    const nodeB = {
      game_id: 'b',
      game_type: 'ContactPerp',
      full_path: 'Imperium.B',
      gestalt: 'b',
      instance_data: {},
    };
    const state = Object.assign({}, base, { nodes: [nodeA, nodeB] });

    const delta = {
      kind: 'delta',
      addr,
      op: 'chargePerp',
      args: ['Imperium.B'],
      ts: 1000,
      result: {
        chargeEntry: {
          path: 'Imperium.B',
          charge_start: 1000,
          charge_end: 31000,
          result: { amount: 100 },
        },
        cashDelta: 60,
        xpInc: 1,
      },
    };
    const out = applyDelta(state, delta);

    const a = out.nodes.find((n) => n.full_path === 'Imperium.A');
    const b = out.nodes.find((n) => n.full_path === 'Imperium.B');
    expect(b.instance_data.charge_start).toBe(1000);
    expect(a.instance_data.charge_start).toBeUndefined();
    expect(out.nodes_charging).toHaveLength(1);
    expect(out.nodes_charging[0].path).toBe('Imperium.B');
  });
});

describe('applyDelta — other-peer filter', () => {
  // Phase 6: foreign deltas now update state.peers[foreignAddr] (peer
  // aggregator runs for all deltas) while still blocking per-self mutations.
  it('does not mutate per-self state for a foreign delta', () => {
    const s = freshState('alice@example.com');
    const foreignDelta = makeDelta('bob@example.com', 'buyKarma', 1000);
    const result = applyDelta(s, foreignDelta);
    // Per-self fields unchanged.
    expect(result.game_values).toEqual(s.game_values);
    expect(result.display_name).toBe(s.display_name);
    expect(result.nodes).toBe(s.nodes);
    // Peer aggregator DID add a peers entry for the foreign addr.
    expect(result.peers['bob@example.com']).toBeDefined();
    expect(result.peers['bob@example.com'].last_seen_ts).toBe(1000);
  });

  it('processes own-addr deltas normally', () => {
    const addr = 'alice@example.com';
    const s = freshState(addr);
    const result = applyDelta(s, makeDelta(addr, 'ping', 1000));
    expect(result).not.toBe(s);
    expect(result.schema_version).toBe(SCHEMA_VERSION);
  });

  // Regression test for #130: a foreign delta arriving before selfAddr is
  // established must not seed state.addr and must be dropped from own state.
  it('empty state.addr + foreign delta: state.addr stays empty, delta dropped', () => {
    const s = freshState(); // state.addr === ''
    const foreignDelta = makeDelta('bob@example.com', 'ping', 1000);
    const result = applyDelta(s, foreignDelta);
    expect(result.addr).toBe('');
    // Per-self fields unchanged (delta was dropped from own state).
    expect(result.game_values).toEqual(s.game_values);
    expect(result.nodes).toBe(s.nodes);
    // Peer aggregator still ran.
    expect(result.peers['bob@example.com']).toBeDefined();
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
    return {
      kind: 'delta',
      addr,
      op: 'dismissMissionBriefing',
      args: [gestalt],
      ts: ts || Date.now(),
    };
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

// ---------------------------------------------------------------------------
// #117 / #130 — addr guard and pre-boot replay
// ---------------------------------------------------------------------------

describe('applyDelta — addr guard and pre-boot replay (#117 / #130)', () => {
  // #117 is closed by boot.js seeding state.addr from webxdc.selfAddr BEFORE
  // the listener is registered.  #130 removes the unsafe Guard 2b that seeded
  // state.addr from the first inbound delta (which could be a peer delta).

  it('replays own deltas correctly when selfAddr is set before replay starts', () => {
    // The correct usage: always pass selfAddr to freshState (as boot.js does).
    var deltas = [
      { kind: 'delta', addr: 'alice@local', op: 'markTokenSeen', args: ['token008'], ts: 1 },
      { kind: 'delta', addr: 'alice@local', op: 'markTokenSeen', args: ['token001'], ts: 2 },
    ];
    var replayed = deltas.reduce(applyDelta, freshState('alice@local'));
    expect(replayed.addr).toBe('alice@local');
    expect(replayed.tokens_seen).toEqual({ token008: true, token001: true });
  });

  it('empty state.addr + own-addr delta is dropped (not seeded) — use boot.js pattern instead', () => {
    // Without selfAddr set upfront, even own-addr deltas cannot be processed
    // because state.addr is unknown.  This reinforces that boot.js MUST seed
    // selfAddr before replay (closes #130: foreign deltas must not do it).
    var s = freshState('');
    var delta = {
      kind: 'delta',
      addr: 'alice@local',
      op: 'markTokenSeen',
      args: ['token008'],
      ts: 1,
    };
    var result = applyDelta(s, delta);
    expect(result.addr).toBe('');
    expect(result.tokens_seen).toEqual({});
  });
});
