// @ts-nocheck — strict-TS quarantine; remove when this file is migrated to TS (issue #147)
import { describe, expect, it } from 'vitest';
import { COMPACT_DELTA_TAG, OP_CODE, decodeDelta, encodeDelta } from '../../scripts/delta-codec.js';
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
      r: { game_values: { karma_value: 60 } },
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
  it('a compact delta applied via applyDelta matches the verbose path', () => {
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

describe('wire-format drift guard', () => {
  it('every op in state.ts OP_NAMES has a stable code in OP_CODE', () => {
    const missing = OP_NAMES.filter((op) => !Object.prototype.hasOwnProperty.call(OP_CODE, op));
    expect(missing).toEqual([]);
  });

  it('OP_CODE has no duplicate codes', () => {
    const codes = Object.values(OP_CODE);
    expect(new Set(codes).size).toBe(codes.length);
  });
});
