/**
 * Tests for Phase 6 peer-score aggregation (issue #29).
 *
 * Covers three scenarios:
 *   1. state.peers is populated correctly from delta history.
 *   2. getRanking sorts/slices correctly and tags the self row.
 *   3. Property: final state.peers is independent of delta arrival order
 *      (convergence / replay-safety).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { freshState, applyDelta } from '../../scripts/state.js';
import { getState, setState } from '../../scripts/boot.js';
import { getRanking } from '../../scripts/LocalEngine.js';

// ── fixtures ──────────────────────────────────────────────────────────────────

function mkGv(overrides) {
  return Object.assign(
    { cash_value: 0, profiles_value: 0, xp_value: 0, xp_level: 1 },
    overrides || {}
  );
}

// Minimal delta that carries a game_values snapshot.
function mkDelta(addr, op, gvOverrides, ts) {
  return {
    kind:   'delta',
    addr:   addr,
    op:     op || 'buyKarma',
    args:   [],
    result: { game_values: mkGv(gvOverrides) },
    ts:     typeof ts === 'number' ? ts : 1000,
  };
}

// Replay an ordered list of deltas from a fresh state seeded with selfAddr.
function replay(selfAddr, deltas) {
  return deltas.reduce(
    function (s, d) { return applyDelta(s, d); },
    freshState(selfAddr)
  );
}

// ── state.peers population ────────────────────────────────────────────────────

describe('state.peers — initialisation', () => {
  it('freshState initialises peers as {}', () => {
    expect(freshState('alice@test').peers).toEqual({});
  });
});

describe('state.peers — aggregation from own deltas', () => {
  it('populates self entry from game_values', () => {
    const s = replay('alice@test', [
      mkDelta('alice@test', 'buyKarma', { cash_value: 100, profiles_value: 5, xp_value: 10, xp_level: 2 }, 1000),
    ]);
    expect(s.peers['alice@test']).toMatchObject({ cash: 100, profiles: 5, xp: 10, level: 2 });
  });

  it('updates last_seen_ts from delta.ts', () => {
    const s = replay('alice@test', [
      mkDelta('alice@test', 'chargePerp', { xp_value: 5, xp_level: 1 }, 9999),
    ]);
    expect(s.peers['alice@test'].last_seen_ts).toBe(9999);
  });

  it('sets last_seen_serial to null (serial lives on the webxdc update envelope)', () => {
    const s = replay('alice@test', [
      mkDelta('alice@test', 'buyPerp', { xp_value: 1, xp_level: 1 }, 1000),
    ]);
    expect(s.peers['alice@test'].last_seen_serial).toBeNull();
  });

  it('tracks display_name from own setDisplayName delta', () => {
    const s = replay('alice@test', [
      { kind: 'delta', addr: 'alice@test', op: 'setDisplayName', args: ['Alice'], result: {}, ts: 1000 },
    ]);
    expect(s.peers['alice@test'].display_name).toBe('Alice');
  });

  it('updates peer entry on successive own deltas', () => {
    const s = replay('alice@test', [
      mkDelta('alice@test', 'chargePerp', { cash_value: 100, xp_value: 10, xp_level: 1 }, 1000),
      mkDelta('alice@test', 'collectPerp', { cash_value: 150, xp_value: 15, xp_level: 2 }, 2000),
    ]);
    expect(s.peers['alice@test']).toMatchObject({ cash: 150, xp: 15, level: 2, last_seen_ts: 2000 });
  });
});

describe('state.peers — aggregation from peer deltas', () => {
  it('populates foreign-peer entry from game_values', () => {
    const s = replay('alice@test', [
      mkDelta('bob@test', 'buyKarma', { cash_value: 200, profiles_value: 10, xp_value: 20, xp_level: 3 }, 2000),
    ]);
    expect(s.peers['bob@test']).toMatchObject({ cash: 200, profiles: 10, xp: 20, level: 3 });
  });

  it('tracks foreign peer display_name from setDisplayName', () => {
    const s = replay('alice@test', [
      { kind: 'delta', addr: 'bob@test', op: 'setDisplayName', args: ['Bob'], result: {}, ts: 2000 },
    ]);
    expect(s.peers['bob@test'].display_name).toBe('Bob');
  });

  it('does NOT mutate self display_name from a foreign setDisplayName', () => {
    const s = replay('alice@test', [
      { kind: 'delta', addr: 'bob@test', op: 'setDisplayName', args: ['Bob'], result: {}, ts: 2000 },
    ]);
    // alice's own top-level display_name is unchanged
    expect(s.display_name).toBe('');
    // only the peer bucket is updated
    expect(s.peers['bob@test'].display_name).toBe('Bob');
  });

  it('does NOT apply foreign-peer game reducer (addr guard intact)', () => {
    // A peer delta for buyKarma should not change alice's game_values.
    const s = replay('alice@test', [
      mkDelta('bob@test', 'buyKarma', { cash_value: 9999, xp_value: 9999, xp_level: 99 }, 2000),
    ]);
    // alice.game_values unchanged from fresh seed
    expect(s.game_values.cash_value).not.toBe(9999);
    // but bob's peer entry is set
    expect(s.peers['bob@test'].cash).toBe(9999);
  });

  it('aggregates 3 peers independently', () => {
    const deltas = [
      mkDelta('alice@test', 'buyKarma', { cash_value: 100, profiles_value:  5, xp_value: 10, xp_level: 1 }, 1000),
      mkDelta('bob@test',   'buyKarma', { cash_value: 200, profiles_value: 15, xp_value: 20, xp_level: 2 }, 2000),
      mkDelta('carol@test', 'buyKarma', { cash_value: 300, profiles_value: 25, xp_value: 30, xp_level: 3 }, 3000),
    ];
    const s = replay('alice@test', deltas);
    expect(Object.keys(s.peers)).toHaveLength(3);
    expect(s.peers['alice@test'].cash).toBe(100);
    expect(s.peers['bob@test'].cash).toBe(200);
    expect(s.peers['carol@test'].cash).toBe(300);
  });

  it('later delta overwrites earlier peer values for the same addr', () => {
    const s = replay('alice@test', [
      mkDelta('bob@test', 'chargePerp', { cash_value: 50,  xp_value: 5,  xp_level: 1 }, 1000),
      mkDelta('bob@test', 'collectPerp', { cash_value: 80, xp_value: 12, xp_level: 2 }, 2000),
    ]);
    expect(s.peers['bob@test']).toMatchObject({ cash: 80, xp: 12, level: 2, last_seen_ts: 2000 });
  });
});

// ── convergence property ──────────────────────────────────────────────────────

describe('state.peers — convergence (arrival-order independence)', () => {
  // When each peer has exactly one delta, the final state.peers must be
  // identical regardless of the order in which those deltas are replayed.
  // This is the core "convergent leaderboard" property from issue #29.

  const SELF = 'alice@test';
  const deltas = [
    mkDelta('alice@test', 'buyKarma',  { cash_value: 100, profiles_value:  5, xp_value: 10, xp_level: 1 }, 1000),
    mkDelta('bob@test',   'chargePerp', { cash_value:  50, profiles_value: 20, xp_value:  5, xp_level: 1 }, 2000),
    mkDelta('carol@test', 'collectPerp', { cash_value: 200, profiles_value: 10, xp_value: 30, xp_level: 3 }, 3000),
  ];

  it('produces identical peers for forward vs reverse order', () => {
    const forward  = replay(SELF, deltas);
    const reversed = replay(SELF, deltas.slice().reverse());
    expect(forward.peers).toEqual(reversed.peers);
  });

  it('produces identical peers for all six permutations', () => {
    const [a, b, c] = deltas;
    const permutations = [
      [a, b, c],
      [a, c, b],
      [b, a, c],
      [b, c, a],
      [c, a, b],
      [c, b, a],
    ];
    const results = permutations.map(function (perm) { return replay(SELF, perm).peers; });
    for (var i = 1; i < results.length; i++) {
      expect(results[i]).toEqual(results[0]);
    }
  });
});

// ── getRanking ────────────────────────────────────────────────────────────────

describe('getRanking with multi-peer state', () => {
  beforeEach(() => {
    // Seed state directly: 3 peers with different scores.
    setState(Object.assign(freshState('alice@test'), {
      display_name: 'Alice',
      peers: {
        'alice@test': { display_name: 'Alice', cash: 100, profiles:  5, xp: 10, level: 1, last_seen_ts: 1000, last_seen_serial: null },
        'bob@test':   { display_name: 'Bob',   cash: 200, profiles: 15, xp: 30, level: 3, last_seen_ts: 2000, last_seen_serial: null },
        'carol@test': { display_name: 'Carol', cash:  50, profiles: 20, xp: 20, level: 2, last_seen_ts: 3000, last_seen_serial: null },
      },
    }));
  });

  it('sorts by cash descending', async () => {
    const { result } = await getRanking('tok', 'cash');
    expect(result.top.map(r => r.display_name)).toEqual(['Bob', 'Alice', 'Carol']);
    expect(result.top.map(r => r.value)).toEqual([200, 100, 50]);
  });

  it('sorts by xp descending', async () => {
    const { result } = await getRanking('tok', 'xp');
    expect(result.top.map(r => r.display_name)).toEqual(['Bob', 'Carol', 'Alice']);
  });

  it('sorts by profiles descending', async () => {
    const { result } = await getRanking('tok', 'profiles');
    expect(result.top.map(r => r.display_name)).toEqual(['Carol', 'Bob', 'Alice']);
  });

  it('sorts by level descending', async () => {
    const { result } = await getRanking('tok', 'level');
    expect(result.top.map(r => r.display_name)).toEqual(['Bob', 'Carol', 'Alice']);
  });

  it('tags the self row with self: true', async () => {
    const { result } = await getRanking('tok', 'cash');
    const selfRow = result.top.find(r => r.self === true);
    expect(selfRow).toBeDefined();
    expect(selfRow.display_name).toBe('Alice');
  });

  it('tags exactly one row as self', async () => {
    const { result } = await getRanking('tok', 'cash');
    expect(result.top.filter(r => r.self === true)).toHaveLength(1);
  });

  it('non-self rows have self falsy', async () => {
    const { result } = await getRanking('tok', 'cash');
    result.top.filter(r => r.display_name !== 'Alice')
      .forEach(r => expect(r.self).toBeFalsy());
  });

  it('returns top + user_rank shape', async () => {
    const { result } = await getRanking('tok', 'xp');
    expect(result).toHaveProperty('top');
    expect(Array.isArray(result.top)).toBe(true);
    expect(result).toHaveProperty('user_rank');
    expect(typeof result.user_rank).toBe('number');
  });

  it('user_rank is 1 when self is first', async () => {
    // Override state so alice is the top scorer.
    setState(Object.assign(freshState('alice@test'), {
      peers: {
        'alice@test': { display_name: 'Alice', cash: 999, xp: 999, profiles: 999, level: 9, last_seen_ts: 1, last_seen_serial: null },
        'bob@test':   { display_name: 'Bob',   cash:  50, xp:  50, profiles:  50, level: 1, last_seen_ts: 2, last_seen_serial: null },
      },
    }));
    const { result } = await getRanking('tok', 'cash');
    expect(result.user_rank).toBe(1);
  });

  it('user_rank is 0 when self is last', async () => {
    setState(Object.assign(freshState('alice@test'), {
      peers: {
        'alice@test': { display_name: 'Alice', cash:   1, xp:   1, profiles:   1, level: 1, last_seen_ts: 1, last_seen_serial: null },
        'bob@test':   { display_name: 'Bob',   cash: 999, xp: 999, profiles: 999, level: 9, last_seen_ts: 2, last_seen_serial: null },
      },
    }));
    const { result } = await getRanking('tok', 'cash');
    expect(result.user_rank).toBe(0);
  });
});
