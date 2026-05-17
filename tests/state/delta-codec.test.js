// @ts-nocheck — strict-TS quarantine; remove when this file is migrated to TS (issue #147)
import { afterEach, describe, expect, it } from 'vitest';
import { clearOverride, setOverride } from '../../scripts/clock.js';
import {
  COMPACT_DELTA_TAG,
  GAME_VALUES_FIELD,
  OP_CODE,
  decodeDelta,
  encodeDelta,
} from '../../scripts/delta-codec.js';
import { OP_NAMES, applyDelta, freshState } from '../../scripts/state.js';

function verbose(overrides) {
  return Object.assign(
    {
      kind: 'delta',
      addr: 'alice@example.com',
      op: 'buyKarma',
      args: ['karma001'],
      result: { game_values: { karma_value: 60 } },
      ts: 1700000000000,
    },
    overrides
  );
}

describe('encodeDelta / decodeDelta — round trip', () => {
  it('round-trips a full delta losslessly', () => {
    const d = verbose();
    expect(decodeDelta(encodeDelta(d))).toEqual(d);
  });

  it('round-trips for every op in OP_CODE', () => {
    for (const op of Object.keys(OP_CODE)) {
      const d = verbose({ op });
      expect(decodeDelta(encodeDelta(d))).toEqual(d);
    }
  });

  it('round-trips with locale present and args/result/ts absent', () => {
    const d = { kind: 'delta', addr: 'a@b', op: 'setLocale', locale: 'en' };
    expect(decodeDelta(encodeDelta(d))).toEqual(d);
  });

  it('round-trips an unknown op as a raw string (no code assigned)', () => {
    const d = verbose({ op: 'someFutureOp' });
    const enc = encodeDelta(d);
    expect(enc.o).toBe('someFutureOp');
    expect(decodeDelta(enc)).toEqual(d);
  });
});

describe('encodeDelta — compact shape', () => {
  it('uses single-letter keys and a numeric op code', () => {
    const enc = encodeDelta(verbose());
    expect(enc).toEqual({
      k: COMPACT_DELTA_TAG,
      a: 'alice@example.com',
      o: OP_CODE.buyKarma,
      g: ['karma001'],
      r: { game_values: { [GAME_VALUES_FIELD.karma_value]: 60 } },
      t: 1700000000000,
    });
    expect(typeof enc.o).toBe('number');
  });

  it('omits optional fields that were undefined on the source delta', () => {
    const enc = encodeDelta({ kind: 'delta', addr: 'a@b', op: 'ping' });
    expect(enc).toEqual({ k: COMPACT_DELTA_TAG, a: 'a@b', o: OP_CODE.ping });
    expect('g' in enc).toBe(false);
    expect('r' in enc).toBe(false);
    expect('t' in enc).toBe(false);
    expect('l' in enc).toBe(false);
  });

  it('is meaningfully smaller than the verbose JSON', () => {
    const d = verbose();
    expect(JSON.stringify(encodeDelta(d)).length).toBeLessThan(JSON.stringify(d).length);
  });
});

describe('decodeDelta — tolerant of legacy and foreign payloads', () => {
  it('passes a legacy verbose delta through unchanged (idempotent)', () => {
    const d = verbose();
    expect(decodeDelta(d)).toBe(d);
  });

  it('is idempotent: decode(decode(compact)) === decode(compact)', () => {
    const once = decodeDelta(encodeDelta(verbose()));
    expect(decodeDelta(once)).toEqual(once);
  });

  it('passes an achievement payload through unchanged', () => {
    const ach = { kind: 'achievement', achievement_kind: 'levelup', addr: 'a@b' };
    expect(decodeDelta(ach)).toBe(ach);
  });

  it('passes an unknown keyless payload through unchanged', () => {
    const x = { foo: 1 };
    expect(decodeDelta(x)).toBe(x);
  });

  it('returns non-object inputs unchanged', () => {
    expect(decodeDelta(null)).toBe(null);
    expect(decodeDelta(undefined)).toBe(undefined);
    expect(decodeDelta('str')).toBe('str');
    expect(decodeDelta(42)).toBe(42);
  });
});

describe('codec ↔ applyDelta integration', () => {
  // applyDelta stamps last_seen_ts = max(clockNow(), …); pin the injectable
  // clock so the two applyDelta calls below are compared at the same instant
  // (otherwise a millisecond tick between them flakes the toEqual).
  afterEach(clearOverride);

  it('a compact delta applied via applyDelta matches the verbose path', () => {
    setOverride(1700000000000);
    const base = freshState('alice@example.com');
    const seeded = Object.assign({}, base, {
      game_values: Object.assign({}, base.game_values, { karma_value: 50, cash_value: 1000 }),
    });
    const d = verbose({ addr: 'alice@example.com' });

    const fromVerbose = applyDelta(seeded, d);
    const fromCompact = applyDelta(seeded, encodeDelta(d));

    expect(fromCompact).toEqual(fromVerbose);
  });
});

describe('game_values key compaction + migration', () => {
  afterEach(clearOverride);

  const fullGv = {
    xp_value: 1200,
    xp_level: 7,
    cash_value: 980,
    cash_spent: 4400,
    karma_value: 60,
    profiles_value: 12,
    profiles_max: 25,
    ap_snapshot: 88,
    ap_update: null, // null on a fresh game — must survive the round trip
    ap_inc_value: 3,
    ap_inc_interval: 60000,
    ap_max: 100,
  };

  it('emits short codes for known counters (write short form only)', () => {
    const enc = encodeDelta(verbose({ result: { game_values: fullGv } }));
    // Every emitted key is a code, never a verbose counter name.
    expect(Object.keys(enc.r.game_values).sort()).toEqual(Object.values(GAME_VALUES_FIELD).sort());
    expect(enc.r.game_values[GAME_VALUES_FIELD.cash_value]).toBe(980);
    expect(enc.r.game_values).not.toHaveProperty('cash_value');
  });

  it('round-trips a fully populated game_values losslessly (incl. null)', () => {
    const d = verbose({ result: { game_values: fullGv } });
    expect(decodeDelta(encodeDelta(d))).toEqual(d);
  });

  it('round-trips every known counter individually', () => {
    for (const name of Object.keys(GAME_VALUES_FIELD)) {
      const d = verbose({ result: { game_values: { [name]: 42 } } });
      const enc = encodeDelta(d);
      expect(enc.r.game_values).toEqual({ [GAME_VALUES_FIELD[name]]: 42 });
      expect(decodeDelta(enc)).toEqual(d);
    }
  });

  it('carries an unknown/dynamic counter through verbatim (open index)', () => {
    const d = verbose({
      result: { game_values: { cash_value: 5, some_future_counter: 9 } },
    });
    const enc = encodeDelta(d);
    expect(enc.r.game_values).toEqual({
      [GAME_VALUES_FIELD.cash_value]: 5,
      some_future_counter: 9,
    });
    expect(decodeDelta(enc)).toEqual(d);
  });

  it('leaves sibling result fields (e.g. node) untouched', () => {
    const node = { full_path: 'Imperium.contact035', instance_data: { x: 1 } };
    const d = verbose({ result: { node, game_values: { cash_value: 7 } } });
    const enc = encodeDelta(d);
    expect(enc.r.node).toEqual(node);
    expect(decodeDelta(enc)).toEqual(d);
  });

  it('does not mutate the source delta', () => {
    const d = verbose({ result: { game_values: { cash_value: 1 } } });
    const snapshot = JSON.parse(JSON.stringify(d));
    encodeDelta(d);
    expect(d).toEqual(snapshot);
  });

  it('reads the legacy long form: a verbose delta passes through unchanged', () => {
    const legacy = verbose({ result: { game_values: { cash_value: 270 } } });
    // Migration contract: old persisted deltas keep their long keys and are
    // handed straight to applyDelta's verbose-aware reducers.
    expect(decodeDelta(legacy)).toBe(legacy);
  });

  it('reads a compact delta that already carries a long key (mixed history)', () => {
    // A short-form envelope whose game_values still holds a verbose key must
    // decode that key untouched (it is just an unmapped key on decode).
    const compact = {
      k: COMPACT_DELTA_TAG,
      a: 'a@b',
      o: OP_CODE.buyKarma,
      r: { game_values: { [GAME_VALUES_FIELD.cash_value]: 5, karma_value: 9 } },
    };
    expect(decodeDelta(compact).result.game_values).toEqual({
      cash_value: 5,
      karma_value: 9,
    });
  });

  it('decodes short game_values so applyDelta reducers see long keys', () => {
    setOverride(1700000000000);
    const base = freshState('alice@example.com');
    const d = verbose({
      addr: 'alice@example.com',
      op: 'buyKarma',
      result: { game_values: { karma_value: 77, cash_value: 123 } },
    });
    const fromVerbose = applyDelta(base, d);
    const fromCompact = applyDelta(base, encodeDelta(d));
    expect(fromCompact).toEqual(fromVerbose);
    expect(fromCompact.game_values.karma_value).toBe(77);
  });
});

describe('wire-format drift guard', () => {
  it('every op in state.ts OP_NAMES has a stable code in OP_CODE', () => {
    const missing = OP_NAMES.filter((op) => !Object.prototype.hasOwnProperty.call(OP_CODE, op));
    expect(missing).toEqual([]);
  });

  it('OP_CODE has no duplicate codes', () => {
    const codes = Object.values(OP_CODE);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('GAME_VALUES_FIELD has no duplicate codes', () => {
    const codes = Object.values(GAME_VALUES_FIELD);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('GAME_VALUES_FIELD codes never collide with a verbose counter name', () => {
    // Decode disambiguates code vs raw key by reverse-map membership; a code
    // equal to a real counter name would make an unmapped key ambiguous.
    const names = new Set(Object.keys(GAME_VALUES_FIELD));
    const collision = Object.values(GAME_VALUES_FIELD).filter((c) => names.has(c));
    expect(collision).toEqual([]);
  });
});
