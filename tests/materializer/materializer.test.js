import { describe, it, expect } from 'vitest';
import { materialize } from '../../scripts/materializer.js';

// ── test fixtures ────────────────────────────────────────────────────────────

function baseState(overrides) {
  return Object.assign({
    nodes_charging: [],
    nodes_collect:  [],
    game_values: {
      ap_snapshot:     10,
      ap_update:        0,
      ap_inc_value:     1,
      ap_inc_interval:  60000,  // 1 AP per minute
      ap_max:          20,
    }
  }, overrides);
}

function charge(path, charge_end, game_id, game_type) {
  return {
    path:         path      || 'Imperium.City.Agent0',
    result:       { value: 10 },
    charge_start: 0,
    charge_end:   charge_end != null ? charge_end : 5000,
    game_id:      game_id   || 'abc123',
    game_type:    game_type || 'ContactPerp',
  };
}

// ── charge-cycle rule ────────────────────────────────────────────────────────

describe('chargePerpReady rule', () => {
  it('leaves a charging entry alone before charge_end', () => {
    const s = baseState({ nodes_charging: [charge('p.a', 5000)] });
    const r = materialize(s, 4999);
    expect(r.state.nodes_charging).toHaveLength(1);
    expect(r.state.nodes_collect).toHaveLength(0);
    expect(r.events).toHaveLength(0);
  });

  it('moves the entry at exactly charge_end', () => {
    const s = baseState({ nodes_charging: [charge('p.a', 5000)] });
    const r = materialize(s, 5000);
    expect(r.state.nodes_charging).toHaveLength(0);
    expect(r.state.nodes_collect).toHaveLength(1);
    expect(r.state.nodes_collect[0].path).toBe('p.a');
  });

  it('does not mutate the input state', () => {
    const s = baseState({ nodes_charging: [charge('p.a', 5000)] });
    const original_len = s.nodes_charging.length;
    materialize(s, 9999);
    expect(s.nodes_charging).toHaveLength(original_len);
  });

  it('emits a node_ready event with correct payload shape', () => {
    const c = charge('p.a', 5000, 'id1', 'ContactPerp');
    const s = baseState({ nodes_charging: [c] });
    const r = materialize(s, 5000);
    expect(r.events).toHaveLength(1);
    expect(r.events[0]).toEqual({
      ev: 'node_ready',
      pl: { id: 'id1', type: 'ContactPerp', path: 'p.a', result: c.result }
    });
  });

  it('emits multiple events in temporal order (earliest charge_end first)', () => {
    const s = baseState({
      nodes_charging: [
        charge('p.b', 8000, 'id2', 'T'),
        charge('p.a', 5000, 'id1', 'T'),
        charge('p.c', 3000, 'id3', 'T'),
      ]
    });
    const r = materialize(s, 10000);
    expect(r.events.map(e => e.pl.path)).toEqual(['p.c', 'p.a', 'p.b']);
  });

  it('preserves pre-existing nodes_collect entries', () => {
    const existing = { path: 'p.x', result: { value: 5 } };
    const s = baseState({
      nodes_charging: [charge('p.a', 5000)],
      nodes_collect:  [existing],
    });
    const r = materialize(s, 5000);
    expect(r.state.nodes_collect).toHaveLength(2);
    expect(r.state.nodes_collect[0]).toEqual(existing);
  });

  it('deduplicates a path already present in nodes_collect', () => {
    // Guard: if somehow both arrays contain the same path, don't double-add.
    const s = baseState({
      nodes_charging: [charge('p.a', 5000)],
      nodes_collect:  [{ path: 'p.a', result: { value: 10 } }],
    });
    const r = materialize(s, 5000);
    expect(r.state.nodes_collect).toHaveLength(1);
    // Event is still emitted (the transition did occur).
    expect(r.events).toHaveLength(1);
  });

  it('keeps still-charging entries in nodes_charging', () => {
    const s = baseState({
      nodes_charging: [
        charge('p.done',  1000),
        charge('p.later', 9000),
      ]
    });
    const r = materialize(s, 5000);
    expect(r.state.nodes_charging).toHaveLength(1);
    expect(r.state.nodes_charging[0].path).toBe('p.later');
    expect(r.state.nodes_collect).toHaveLength(1);
    expect(r.state.nodes_collect[0].path).toBe('p.done');
  });
});

// ── AP regen rule ────────────────────────────────────────────────────────────

describe('AP regen rule', () => {
  it('advances AP by the correct number of ticks', () => {
    const s = baseState({
      game_values: { ap_snapshot: 5, ap_update: 0,
                     ap_inc_value: 2, ap_inc_interval: 1000, ap_max: 100 }
    });
    const r = materialize(s, 3000);  // 3 ticks × 2 = 6
    expect(r.state.game_values.ap_snapshot).toBe(11);
    expect(r.state.game_values.ap_update).toBe(3000);
  });

  it('caps AP at ap_max', () => {
    const s = baseState({
      game_values: { ap_snapshot: 18, ap_update: 0,
                     ap_inc_value: 5, ap_inc_interval: 1000, ap_max: 20 }
    });
    expect(materialize(s, 5000).state.game_values.ap_snapshot).toBe(20);
  });

  it('does not advance AP before a full interval elapses', () => {
    const s = baseState({
      game_values: { ap_snapshot: 5, ap_update: 0,
                     ap_inc_value: 1, ap_inc_interval: 1000, ap_max: 20 }
    });
    expect(materialize(s, 999).state.game_values.ap_snapshot).toBe(5);
  });

  it('does not alter game_values when AP fields are absent', () => {
    const s = baseState({ game_values: { xp_value: 42 } });
    const r = materialize(s, 9999);
    expect(r.state.game_values).toEqual({ xp_value: 42 });
  });

  it('does not regress AP when now < ap_update', () => {
    const s = baseState({
      game_values: { ap_snapshot: 10, ap_update: 5000,
                     ap_inc_value: 1, ap_inc_interval: 1000, ap_max: 20 }
    });
    expect(materialize(s, 3000).state.game_values.ap_snapshot).toBe(10);
  });
});

// ── idempotence ──────────────────────────────────────────────────────────────
//
// materialize(materialize(s, t).state, t).state  ≡  materialize(s, t).state
//
// Applying the same timestamp twice arrives at the same state — no further
// transitions occur, no duplicate entries accumulate.

describe('idempotence', () => {
  it('state is unchanged on a second call with the same t', () => {
    const s = baseState({
      nodes_charging: [charge('p.a', 5000), charge('p.b', 3000)],
    });
    const r1 = materialize(s, 6000);
    const r2 = materialize(r1.state, 6000);
    expect(r2.state).toEqual(r1.state);
  });

  it('no events are emitted on the second call with the same t', () => {
    const s = baseState({ nodes_charging: [charge('p.a', 5000)] });
    const r1 = materialize(s, 6000);
    expect(materialize(r1.state, 6000).events).toHaveLength(0);
  });

  it('AP snapshot does not drift on repeated same-t calls', () => {
    const s = baseState({
      game_values: { ap_snapshot: 0, ap_update: 0,
                     ap_inc_value: 1, ap_inc_interval: 1000, ap_max: 50 }
    });
    const t = 5000;
    const r1 = materialize(s, t);
    const r2 = materialize(r1.state, t);
    expect(r2.state.game_values.ap_snapshot)
      .toBe(r1.state.game_values.ap_snapshot);
  });
});

// ── monotonicity ─────────────────────────────────────────────────────────────
//
// Increasing `now` never loses progress: nodes_collect count is non-decreasing
// and AP is non-decreasing (up to cap).

describe('monotonicity', () => {
  it('nodes_collect count is non-decreasing as t increases', () => {
    const s = baseState({
      nodes_charging: [
        charge('p.a', 1000),
        charge('p.b', 3000),
        charge('p.c', 5000),
      ]
    });
    const times = [0, 500, 1000, 2000, 3000, 4000, 5000, 10000];
    let prev = 0;
    for (const t of times) {
      const len = materialize(s, t).state.nodes_collect.length;
      expect(len).toBeGreaterThanOrEqual(prev);
      prev = len;
    }
  });

  it('AP is non-decreasing as t increases', () => {
    const s = baseState({
      game_values: { ap_snapshot: 0, ap_update: 0,
                     ap_inc_value: 1, ap_inc_interval: 1000, ap_max: 10 }
    });
    const times = [0, 1000, 2000, 5000, 9000, 10000, 20000];
    let prev = 0;
    for (const t of times) {
      const ap = materialize(s, t).state.game_values.ap_snapshot;
      expect(ap).toBeGreaterThanOrEqual(prev);
      prev = ap;
    }
  });
});

// ── composability ────────────────────────────────────────────────────────────
//
// N stepwise materializations t0→t1→…→tN arrive at the same state as one
// big-step materialization t0→tN.
// For events: accumulated stepwise events equal the big-step events array.

describe('composability', () => {
  it('two-step state equals big-step state', () => {
    const s = baseState({
      nodes_charging: [charge('p.a', 2000), charge('p.b', 7000)],
      game_values: { ap_snapshot: 0, ap_update: 0,
                     ap_inc_value: 1, ap_inc_interval: 1000, ap_max: 50 }
    });
    const r1 = materialize(s, 3000);
    const r2 = materialize(r1.state, 9000);
    expect(r2.state).toEqual(materialize(s, 9000).state);
  });

  it('accumulated two-step events equal big-step events', () => {
    const s = baseState({
      nodes_charging: [
        charge('p.a', 2000, 'id1', 'T'),
        charge('p.b', 7000, 'id2', 'T'),
      ]
    });
    const r1 = materialize(s, 3000);
    const r2 = materialize(r1.state, 9000);
    expect([...r1.events, ...r2.events]).toEqual(materialize(s, 9000).events);
  });

  it('five-step state equals big-step state', () => {
    const s = baseState({
      nodes_charging: [
        charge('p.a', 1500),
        charge('p.b', 3500),
        charge('p.c', 7000),
      ],
      game_values: { ap_snapshot: 3, ap_update: 0,
                     ap_inc_value: 2, ap_inc_interval: 1000, ap_max: 100 }
    });
    let cur = s;
    for (const t of [1000, 2000, 4000, 6000, 8000]) {
      cur = materialize(cur, t).state;
    }
    expect(cur).toEqual(materialize(s, 8000).state);
  });
});

// ── property: random delta sequences ────────────────────────────────────────
//
// For any sequence of non-decreasing timestamps t0 ≤ t1 ≤ … ≤ tN,
// stepwise materialization to tN must equal a single big-step to tN.
// Verified over 50 random trials using a seeded LCG so failures are
// reproducible.

describe('property — random delta sequences', () => {
  // Minimal seeded LCG PRNG (same algorithm across all JS engines).
  function prng(seed) {
    let s = seed >>> 0;
    return function rand() {
      s = (Math.imul(1664525, s) + 1013904223) >>> 0;
      return s / 0xFFFFFFFF;
    };
  }

  it('N random stepwise advances produce the same final state as one big jump', () => {
    const rand = prng(0xDEADBEEF);

    for (let trial = 0; trial < 50; trial++) {
      // Random charge entries (1–5) with charge_ends in 0–100 s
      const numCharges = Math.floor(rand() * 5) + 1;
      const charges = [];
      for (let i = 0; i < numCharges; i++) {
        charges.push(charge('p.' + i, Math.floor(rand() * 100000), 'id' + i, 'T'));
      }

      const s = baseState({
        nodes_charging: charges,
        game_values: {
          ap_snapshot:     0,
          ap_update:       0,
          ap_inc_value:    Math.floor(rand() * 3) + 1,
          ap_inc_interval: Math.floor(rand() * 5000) + 1000,
          ap_max:          Math.floor(rand() * 50) + 10,
        }
      });

      const tFinal = Math.floor(rand() * 150000);

      // Random monotonically-increasing intermediate timestamps
      const numSteps = Math.floor(rand() * 6) + 1;
      const steps = [];
      for (let i = 0; i < numSteps; i++) {
        steps.push(Math.floor(rand() * tFinal));
      }
      steps.sort((a, b) => a - b);
      steps.push(tFinal);   // always end exactly at tFinal

      // Stepwise path
      let cur = s;
      for (const t of steps) {
        cur = materialize(cur, t).state;
      }

      // Big-step path
      const big = materialize(s, tFinal).state;

      expect(cur).toEqual(big);
    }
  });
});
