import { describe, it, expect, afterEach } from 'vitest';
import { now, setOverride, clearOverride, advance } from '../../scripts/clock.js';
import { freshState, applyDelta } from '../../scripts/state.js';
import { materialize } from '../../scripts/materializer.js';

// Always restore real clock after each test to prevent cross-test pollution.
afterEach(() => {
  clearOverride();
});

// ── basic override behaviour ─────────────────────────────────────────────────

describe('now() — override lifecycle', () => {
  it('returns the override value when one is set', () => {
    setOverride(1_000_000);
    expect(now()).toBe(1_000_000);
  });

  it('returns different overrides as they are set', () => {
    setOverride(111);
    expect(now()).toBe(111);
    setOverride(999);
    expect(now()).toBe(999);
  });

  it('returns Date.now() once the override is cleared', () => {
    setOverride(1_000_000);
    clearOverride();
    const before = Date.now();
    const result = now();
    const after  = Date.now();
    expect(result).toBeGreaterThanOrEqual(before);
    expect(result).toBeLessThanOrEqual(after);
  });

  it('allows override = 0', () => {
    setOverride(0);
    expect(now()).toBe(0);
  });
});

// ── advance() ────────────────────────────────────────────────────────────────

describe('advance()', () => {
  it('moves the clock forward by deltaMs from a set override', () => {
    setOverride(1_000_000);
    advance(86_400_000); // + 1 day
    expect(now()).toBe(1_000_000 + 86_400_000);
  });

  it('can be called multiple times cumulatively', () => {
    setOverride(0);
    advance(1_000);
    advance(2_000);
    expect(now()).toBe(3_000);
  });

  it('starts from real Date.now() when no override is active', () => {
    const before = Date.now();
    advance(86_400_000);
    const result = now();
    expect(result).toBeGreaterThanOrEqual(before + 86_400_000);
    // Should not be astronomically large (within a second of our advance)
    expect(result).toBeLessThan(before + 86_400_000 + 1_000);
  });

  it('tests can advance a day in O(1) without setTimeout', () => {
    setOverride(1_000_000_000);
    advance(86_400_000);
    expect(now()).toBe(1_000_000_000 + 86_400_000);
  });
});

// ── clock-skew guard (state.js integration) ──────────────────────────────────
//
// Setting override below the current last_seen_ts must NOT rewind stored
// progress.  The guard Math.max(clockNow(), last_seen_ts) in applyDelta
// ensures this even when the clock override is stale or set backwards.

describe('clock-skew guard survives a backwards override', () => {
  function makeDelta(addr, op) {
    return { kind: 'delta', addr, op, args: [], result: {}, ts: Date.now() };
  }

  it('last_seen_ts does not decrease when override < last_seen_ts', () => {
    const addr = 'alice@example.com';
    const highTs = Date.now() + 1_000_000; // 1000 s into the future
    const s = { ...freshState(addr), last_seen_ts: highTs };

    // Set override well below the recorded last_seen_ts
    setOverride(highTs - 500_000);

    const result = applyDelta(s, makeDelta(addr, 'ping'));
    expect(result.last_seen_ts).toBeGreaterThanOrEqual(highTs);
  });

  it('last_seen_ts advances when override > last_seen_ts', () => {
    const addr = 'alice@example.com';
    const base = Date.now();
    const s = { ...freshState(addr), last_seen_ts: base };

    setOverride(base + 1_000_000);

    const result = applyDelta(s, makeDelta(addr, 'ping'));
    expect(result.last_seen_ts).toBe(base + 1_000_000);
  });
});

// ── materializer integration ─────────────────────────────────────────────────
//
// Verify that clock.now() can drive materialize() and that idempotence and
// monotonicity hold when the clock module is in the loop.

describe('materializer integration with clock', () => {
  function baseState(overrides) {
    return Object.assign({
      nodes_charging: [],
      nodes_collect:  [],
      game_values: {
        ap_snapshot:      0,
        ap_update:        0,
        ap_inc_value:     1,
        ap_inc_interval:  1_000,
        ap_max:           50,
      }
    }, overrides);
  }

  function makeCharge(path, charge_end) {
    return { path, result: {}, charge_start: 0, charge_end, game_id: 'g1', game_type: 'T' };
  }

  it('materialize driven by clock.now() fires charges correctly', () => {
    const s = baseState({ nodes_charging: [makeCharge('p.a', 5_000)] });
    setOverride(5_000);
    const r = materialize(s, now());
    expect(r.state.nodes_collect).toHaveLength(1);
    expect(r.events).toHaveLength(1);
  });

  it('idempotence: second call with same clock value produces no new events', () => {
    const s = baseState({ nodes_charging: [makeCharge('p.a', 5_000)] });
    setOverride(6_000);
    const r1 = materialize(s, now());
    const r2 = materialize(r1.state, now());
    expect(r2.events).toHaveLength(0);
    expect(r2.state).toEqual(r1.state);
  });

  it('monotonicity: advancing the clock never loses collected nodes', () => {
    const s = baseState({
      nodes_charging: [makeCharge('p.a', 2_000), makeCharge('p.b', 6_000)],
    });

    setOverride(0);
    const steps = [1_000, 2_000, 4_000, 6_000, 10_000];
    let cur = s;
    let prevCollected = 0;
    for (const t of steps) {
      setOverride(t);
      const r = materialize(cur, now());
      cur = r.state;
      expect(cur.nodes_collect.length).toBeGreaterThanOrEqual(prevCollected);
      prevCollected = cur.nodes_collect.length;
    }
  });

  it('advance(1 day) in O(1) triggers charges without setTimeout', () => {
    const oneDayMs = 86_400_000;
    const s = baseState({
      nodes_charging: [makeCharge('future.charge', oneDayMs - 1)],
    });
    setOverride(0);
    advance(oneDayMs);
    const r = materialize(s, now());
    expect(r.state.nodes_collect).toHaveLength(1);
  });
});
