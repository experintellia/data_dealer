// @ts-nocheck — strict-TS quarantine; remove when this file is migrated to TS (issue #147)
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
    { cash_value: 0, profiles_value: 0, xp_value: 0, xp_level: 1, cash_spent: 0 },
    overrides || {}
  );
}

// Minimal delta that carries a game_values snapshot.
function mkDelta(addr, op, gvOverrides, ts) {
  return {
    kind: 'delta',
    addr: addr,
    op: op || 'buyKarma',
    args: [],
    result: { game_values: mkGv(gvOverrides) },
    ts: typeof ts === 'number' ? ts : 1000,
  };
}

// Replay an ordered list of deltas from a fresh state seeded with selfAddr.
function replay(selfAddr, deltas) {
  return deltas.reduce(function (s, d) {
    return applyDelta(s, d);
  }, freshState(selfAddr));
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
      mkDelta(
        'alice@test',
        'buyKarma',
        { cash_value: 100, profiles_value: 5, xp_value: 10, xp_level: 2 },
        1000
      ),
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
      {
        kind: 'delta',
        addr: 'alice@test',
        op: 'setDisplayName',
        args: ['Alice'],
        result: {},
        ts: 1000,
      },
    ]);
    expect(s.peers['alice@test'].display_name).toBe('Alice');
  });

  it('updates peer entry on successive own deltas', () => {
    const s = replay('alice@test', [
      mkDelta('alice@test', 'chargePerp', { cash_value: 100, xp_value: 10, xp_level: 1 }, 1000),
      mkDelta('alice@test', 'collectPerp', { cash_value: 150, xp_value: 15, xp_level: 2 }, 2000),
    ]);
    expect(s.peers['alice@test']).toMatchObject({
      cash: 150,
      xp: 15,
      level: 2,
      last_seen_ts: 2000,
    });
  });

  it('tracks cash_spent as peer.spent', () => {
    const s = replay('alice@test', [
      mkDelta(
        'alice@test',
        'chargePerp',
        { cash_value: 100, xp_value: 5, xp_level: 1, cash_spent: 40 },
        1000
      ),
    ]);
    expect(s.peers['alice@test'].spent).toBe(40);
  });
});

describe('state.peers — timestamp-LWW stale-delta guard', () => {
  // webxdc delivers per-sender messages in order, so a stale delta (ts <
  // last_seen_ts) should only arise from re-delivered echoes or hypothetical
  // multi-device races.  The guard makes the aggregator timestamp-LWW:
  // newer-ts values win regardless of replay insertion order.

  it('does not overwrite a newer snapshot with a stale one', () => {
    // Replay newer delta first, then an older one — stale should be ignored.
    const s = replay('alice@test', [
      mkDelta('alice@test', 'collectPerp', { cash_value: 200, xp_value: 20, xp_level: 2 }, 2000),
      mkDelta('alice@test', 'chargePerp', { cash_value: 50, xp_value: 5, xp_level: 1 }, 1000),
    ]);
    // Stale delta (ts=1000) must not clobber the newer snapshot (ts=2000).
    expect(s.peers['alice@test']).toMatchObject({
      cash: 200,
      xp: 20,
      level: 2,
      last_seen_ts: 2000,
    });
  });

  it('accepts a delta with ts equal to last_seen_ts (idempotent re-delivery)', () => {
    const s = replay('alice@test', [
      mkDelta('alice@test', 'chargePerp', { cash_value: 100, xp_value: 10, xp_level: 1 }, 1000),
      mkDelta('alice@test', 'collectPerp', { cash_value: 150, xp_value: 15, xp_level: 2 }, 1000),
    ]);
    // Same ts — second delta is NOT stale, so it is processed.
    expect(s.peers['alice@test'].cash).toBe(150);
    expect(s.peers['alice@test'].last_seen_ts).toBe(1000);
  });

  it('does not suppress foreign peer stale deltas', () => {
    // The ts guard is per-peer, so a stale bob delta is independent of alice.
    const s = replay('alice@test', [
      mkDelta('bob@test', 'collectPerp', { cash_value: 200, xp_value: 20, xp_level: 2 }, 2000),
      mkDelta('bob@test', 'chargePerp', { cash_value: 50, xp_value: 5, xp_level: 1 }, 1000),
    ]);
    expect(s.peers['bob@test']).toMatchObject({ cash: 200, xp: 20, level: 2, last_seen_ts: 2000 });
  });
});

describe('state.peers — aggregation from peer deltas', () => {
  it('populates foreign-peer entry from game_values', () => {
    const s = replay('alice@test', [
      mkDelta(
        'bob@test',
        'buyKarma',
        { cash_value: 200, profiles_value: 10, xp_value: 20, xp_level: 3 },
        2000
      ),
    ]);
    expect(s.peers['bob@test']).toMatchObject({ cash: 200, profiles: 10, xp: 20, level: 3 });
  });

  it('tracks foreign peer display_name from setDisplayName', () => {
    const s = replay('alice@test', [
      {
        kind: 'delta',
        addr: 'bob@test',
        op: 'setDisplayName',
        args: ['Bob'],
        result: {},
        ts: 2000,
      },
    ]);
    expect(s.peers['bob@test'].display_name).toBe('Bob');
  });

  it('does NOT mutate self display_name from a foreign setDisplayName', () => {
    const s = replay('alice@test', [
      {
        kind: 'delta',
        addr: 'bob@test',
        op: 'setDisplayName',
        args: ['Bob'],
        result: {},
        ts: 2000,
      },
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
      mkDelta(
        'alice@test',
        'buyKarma',
        { cash_value: 100, profiles_value: 5, xp_value: 10, xp_level: 1 },
        1000
      ),
      mkDelta(
        'bob@test',
        'buyKarma',
        { cash_value: 200, profiles_value: 15, xp_value: 20, xp_level: 2 },
        2000
      ),
      mkDelta(
        'carol@test',
        'buyKarma',
        { cash_value: 300, profiles_value: 25, xp_value: 30, xp_level: 3 },
        3000
      ),
    ];
    const s = replay('alice@test', deltas);
    expect(Object.keys(s.peers)).toHaveLength(3);
    expect(s.peers['alice@test'].cash).toBe(100);
    expect(s.peers['bob@test'].cash).toBe(200);
    expect(s.peers['carol@test'].cash).toBe(300);
  });

  it('later delta overwrites earlier peer values for the same addr', () => {
    const s = replay('alice@test', [
      mkDelta('bob@test', 'chargePerp', { cash_value: 50, xp_value: 5, xp_level: 1 }, 1000),
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
    mkDelta(
      'alice@test',
      'buyKarma',
      { cash_value: 100, profiles_value: 5, xp_value: 10, xp_level: 1 },
      1000
    ),
    mkDelta(
      'bob@test',
      'chargePerp',
      { cash_value: 50, profiles_value: 20, xp_value: 5, xp_level: 1 },
      2000
    ),
    mkDelta(
      'carol@test',
      'collectPerp',
      { cash_value: 200, profiles_value: 10, xp_value: 30, xp_level: 3 },
      3000
    ),
  ];

  it('produces identical peers for forward vs reverse order', () => {
    const forward = replay(SELF, deltas);
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
    const results = permutations.map(function (perm) {
      return replay(SELF, perm).peers;
    });
    for (var i = 1; i < results.length; i++) {
      expect(results[i]).toEqual(results[0]);
    }
  });
});

// ── convergence with multiple deltas per address ─────────────────────────────
//
// When the same address sends more than one delta (normal gameplay: charge,
// collect, integrate, …), replaying those deltas in any order must converge
// to the same final peers map.  The timestamp-LWW guard means that only the
// highest-ts snapshot survives for each address, regardless of arrival order.
// Uses 4 deltas across 2 addresses (alice × 2, bob × 2) in all 4! = 24
// permutations.

describe('state.peers — convergence with 4 deltas from 2 addresses', () => {
  const SELF = 'alice@test';

  // alice sends two deltas at ts=1000 and ts=3000; bob sends two at ts=2000 and ts=4000.
  const d_alice_1 = mkDelta(
    'alice@test',
    'chargePerp',
    { cash_value: 50, xp_value: 5, xp_level: 1 },
    1000
  );
  const d_alice_2 = mkDelta(
    'alice@test',
    'collectPerp',
    { cash_value: 120, xp_value: 12, xp_level: 1 },
    3000
  );
  const d_bob_1 = mkDelta(
    'bob@test',
    'chargePerp',
    { cash_value: 80, xp_value: 8, xp_level: 1 },
    2000
  );
  const d_bob_2 = mkDelta(
    'bob@test',
    'collectPerp',
    { cash_value: 200, xp_value: 20, xp_level: 2 },
    4000
  );

  const allFour = [d_alice_1, d_alice_2, d_bob_1, d_bob_2];

  // All 4! = 24 arrival-order permutations, computed once for the whole block.
  const allPerms = (function () {
    var result = [];
    for (var a = 0; a < 4; a++) {
      for (var b = 0; b < 4; b++) {
        if (b === a) continue;
        for (var c = 0; c < 4; c++) {
          if (c === a || c === b) continue;
          var d = [0, 1, 2, 3].find(function (x) {
            return x !== a && x !== b && x !== c;
          });
          result.push([allFour[a], allFour[b], allFour[c], allFour[d]]);
        }
      }
    }
    return result;
  })();

  it('final peers.alice is the highest-ts alice snapshot regardless of delta order', () => {
    allPerms.forEach(function (perm) {
      var s = replay(SELF, perm);
      // alice's latest delta is ts=3000 (cash=120, xp=12).
      expect(s.peers['alice@test']).toMatchObject({ cash: 120, xp: 12, last_seen_ts: 3000 });
    });
  });

  it('final peers.bob is the highest-ts bob snapshot regardless of delta order', () => {
    allPerms.forEach(function (perm) {
      var s = replay(SELF, perm);
      // bob's latest delta is ts=4000 (cash=200, xp=20, level=2).
      expect(s.peers['bob@test']).toMatchObject({
        cash: 200,
        xp: 20,
        level: 2,
        last_seen_ts: 4000,
      });
    });
  });

  it('all 24 permutations produce identical peers maps', () => {
    var reference = replay(SELF, allPerms[0]).peers;
    allPerms.slice(1).forEach(function (perm) {
      expect(replay(SELF, perm).peers).toEqual(reference);
    });
  });

  it('getRanking after all-permutation replay agrees on final scores', async () => {
    var perms = allPerms;
    // Spot-check: first and last permutations produce same getRanking result.
    setState(Object.assign(freshState(SELF), { peers: replay(SELF, perms[0]).peers }));
    const r1 = await getRanking('xp');

    setState(
      Object.assign(freshState(SELF), { peers: replay(SELF, perms[perms.length - 1]).peers })
    );
    const r2 = await getRanking('xp');

    expect(
      r1.result.top
        .map(function (r) {
          return r.addr;
        })
        .sort()
    ).toEqual(
      r2.result.top
        .map(function (r) {
          return r.addr;
        })
        .sort()
    );
    expect(
      r1.result.top
        .map(function (r) {
          return r.value;
        })
        .sort(function (a, b) {
          return b - a;
        })
    ).toEqual(
      r2.result.top
        .map(function (r) {
          return r.value;
        })
        .sort(function (a, b) {
          return b - a;
        })
    );
  });

  it('tie (same-ts): last-processed delta wins for alice when both have ts=3000', () => {
    // Both alice deltas share ts=3000; LWW allows overwrite at equal ts.
    // The second delta processed is the one that sticks.
    const d_tie_1 = mkDelta(
      'alice@test',
      'chargePerp',
      { cash_value: 50, xp_value: 5, xp_level: 1 },
      3000
    );
    const d_tie_2 = mkDelta(
      'alice@test',
      'collectPerp',
      { cash_value: 120, xp_value: 12, xp_level: 1 },
      3000
    );

    var s1 = replay('alice@test', [d_tie_1, d_tie_2]);
    var s2 = replay('alice@test', [d_tie_2, d_tie_1]);

    // Each order sticks the last-applied delta — they may differ, but neither crashes.
    expect(s1.peers['alice@test'].last_seen_ts).toBe(3000);
    expect(s2.peers['alice@test'].last_seen_ts).toBe(3000);
    // The two orderings produce different cash because neither is stale.
    expect(s1.peers['alice@test'].cash).toBe(120);
    expect(s2.peers['alice@test'].cash).toBe(50);
  });

  it('stale-overrides-fresh is blocked: older delta after newer never clobbers', () => {
    // Deliver alice's ts=3000 delta first, then her ts=1000 delta.
    // The ts=1000 delta is stale and must not overwrite the ts=3000 snapshot.
    var s = replay('alice@test', [
      mkDelta('alice@test', 'collectPerp', { cash_value: 120, xp_value: 12, xp_level: 1 }, 3000),
      mkDelta('alice@test', 'chargePerp', { cash_value: 50, xp_value: 5, xp_level: 1 }, 1000),
    ]);
    expect(s.peers['alice@test']).toMatchObject({ cash: 120, xp: 12, last_seen_ts: 3000 });
  });
});

// ── getRanking ────────────────────────────────────────────────────────────────

describe('getRanking with multi-peer state', () => {
  beforeEach(() => {
    // Seed state directly: 3 peers with different scores.
    setState(
      Object.assign(freshState('alice@test'), {
        display_name: 'Alice',
        peers: {
          'alice@test': {
            display_name: 'Alice',
            cash: 100,
            profiles: 5,
            xp: 10,
            level: 1,
            spent: 20,
            last_seen_ts: 1000,
            last_seen_serial: null,
          },
          'bob@test': {
            display_name: 'Bob',
            cash: 200,
            profiles: 15,
            xp: 30,
            level: 3,
            spent: 150,
            last_seen_ts: 2000,
            last_seen_serial: null,
          },
          'carol@test': {
            display_name: 'Carol',
            cash: 50,
            profiles: 20,
            xp: 20,
            level: 2,
            spent: 80,
            last_seen_ts: 3000,
            last_seen_serial: null,
          },
        },
      })
    );
  });

  it('sorts by cash descending', async () => {
    const { result } = await getRanking('cash');
    expect(result.top.map((r) => r.display_name)).toEqual(['Bob', 'Alice', 'Carol']);
    expect(result.top.map((r) => r.value)).toEqual([200, 100, 50]);
  });

  it('sorts by xp descending', async () => {
    const { result } = await getRanking('xp');
    expect(result.top.map((r) => r.display_name)).toEqual(['Bob', 'Carol', 'Alice']);
  });

  it('sorts by profiles descending', async () => {
    const { result } = await getRanking('profiles');
    expect(result.top.map((r) => r.display_name)).toEqual(['Carol', 'Bob', 'Alice']);
  });

  it('sorts by level descending', async () => {
    const { result } = await getRanking('level');
    expect(result.top.map((r) => r.display_name)).toEqual(['Bob', 'Carol', 'Alice']);
  });

  it('sorts by spent descending (Investor tab — cash_spent)', async () => {
    const { result } = await getRanking('spent');
    expect(result.top.map((r) => r.display_name)).toEqual(['Bob', 'Carol', 'Alice']);
    expect(result.top.map((r) => r.value)).toEqual([150, 80, 20]);
  });

  it('tags the self row with self: true', async () => {
    const { result } = await getRanking('cash');
    const selfRow = result.top.find((r) => r.self === true);
    expect(selfRow).toBeDefined();
    expect(selfRow.display_name).toBe('Alice');
  });

  it('tags exactly one row as self', async () => {
    const { result } = await getRanking('cash');
    expect(result.top.filter((r) => r.self === true)).toHaveLength(1);
  });

  it('non-self rows have self falsy', async () => {
    const { result } = await getRanking('cash');
    result.top.filter((r) => r.display_name !== 'Alice').forEach((r) => expect(r.self).toBeFalsy());
  });

  it('returns top + user_rank shape', async () => {
    const { result } = await getRanking('xp');
    expect(result).toHaveProperty('top');
    expect(Array.isArray(result.top)).toBe(true);
    expect(result).toHaveProperty('user_rank');
    expect(typeof result.user_rank).toBe('number');
  });

  it('user_rank is 1 when self is first', async () => {
    // Override state so alice is the top scorer.
    setState(
      Object.assign(freshState('alice@test'), {
        peers: {
          'alice@test': {
            display_name: 'Alice',
            cash: 999,
            xp: 999,
            profiles: 999,
            level: 9,
            last_seen_ts: 1,
            last_seen_serial: null,
          },
          'bob@test': {
            display_name: 'Bob',
            cash: 50,
            xp: 50,
            profiles: 50,
            level: 1,
            last_seen_ts: 2,
            last_seen_serial: null,
          },
        },
      })
    );
    const { result } = await getRanking('cash');
    expect(result.user_rank).toBe(1);
  });

  it('emits addr on every row so the testid template can target peers', async () => {
    const { result } = await getRanking('cash');
    const addrs = result.top.map((r) => r.addr).sort();
    expect(addrs).toEqual(['alice@test', 'bob@test', 'carol@test']);
  });

  it('user_rank is 0 when self is last', async () => {
    setState(
      Object.assign(freshState('alice@test'), {
        peers: {
          'alice@test': {
            display_name: 'Alice',
            cash: 1,
            xp: 1,
            profiles: 1,
            level: 1,
            last_seen_ts: 1,
            last_seen_serial: null,
          },
          'bob@test': {
            display_name: 'Bob',
            cash: 999,
            xp: 999,
            profiles: 999,
            level: 9,
            last_seen_ts: 2,
            last_seen_serial: null,
          },
        },
      })
    );
    const { result } = await getRanking('cash');
    expect(result.user_rank).toBe(0);
  });
});
