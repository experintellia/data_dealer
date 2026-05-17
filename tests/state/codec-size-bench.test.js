// Exploration benchmark — "are even shorter keys worth it?"
//
// Follow-up to the compact delta codec (scripts/delta-codec.ts). The shipped
// codec compacts the envelope + game_values counters; this bench measures how
// much *more* a returning player's persisted log would shrink under
// progressively more aggressive key elimination, so the team can decide
// whether the extra wire-contract complexity is justified.
//
// Nothing here is wired into the production encode path: each variant is a
// pure post-transform of the real encodeDelta() output, measured by JSON byte
// size. The only assertions are loose regression guards on the *shipped*
// codec; the table it logs is the actual deliverable (see the follow-up PR).
import { describe, expect, it } from 'vitest';
import { encodeDelta } from '../../scripts/delta-codec.js';

const addr = 'alice@example.com';
const ts = 1700000000000;
const fullGv = {
  xp_value: 1234567,
  xp_level: 18,
  cash_value: 98231,
  cash_spent: 441230,
  karma_value: 612,
  profiles_value: 137,
  profiles_max: 250,
  ap_snapshot: 88,
  ap_update: 1700000123456,
  ap_inc_value: 3,
  ap_inc_interval: 60000,
  ap_max: 120,
};
const node = (g) => ({
  full_path: `Imperium.${g}`,
  instance_data: { x: 731, y: 412, charge_start: ts, charge_end: ts + 60000, level: 4 },
});
const shapes = {
  setPerpCoordinates: () => ({
    kind: 'delta',
    addr,
    op: 'setPerpCoordinates',
    args: ['Imperium.contact035', 731, 412],
    result: { node: node('contact035') },
    ts,
  }),
  chargePerp: () => ({
    kind: 'delta',
    addr,
    op: 'chargePerp',
    args: ['Imperium.contact035'],
    result: { game_values: { ...fullGv }, node: node('contact035') },
    ts,
  }),
  collectPerp: () => ({
    kind: 'delta',
    addr,
    op: 'collectPerp',
    args: ['Imperium.contact035'],
    result: { game_values: { ...fullGv }, node: node('contact035') },
    ts,
  }),
  buyKarma: () => ({
    kind: 'delta',
    addr,
    op: 'buyKarma',
    args: ['karma001'],
    result: { game_values: { karma_value: 612, cash_value: 98231 } },
    ts,
  }),
  integrateCollected: () => ({
    kind: 'delta',
    addr,
    op: 'integrateCollected',
    args: ['Imperium.contact035', 'c-9f3a'],
    result: { game_values: { profiles_value: 137, xp_value: 1234567, xp_level: 18 } },
    ts,
  }),
  buyPerp: () => ({
    kind: 'delta',
    addr,
    op: 'buyPerp',
    args: ['Imperium', 'contact035'],
    result: { game_values: { ...fullGv }, node: node('contact035') },
    ts,
  }),
  loadGame: () => ({
    kind: 'delta',
    addr,
    op: 'loadGame',
    args: [],
    result: { game_values: { ...fullGv } },
    ts,
  }),
};
const mix = [
  ['setPerpCoordinates', 520],
  ['chargePerp', 170],
  ['collectPerp', 170],
  ['integrateCollected', 70],
  ['buyKarma', 35],
  ['buyPerp', 34],
  ['loadGame', 1],
];
function buildLog() {
  const log = [];
  for (const [op, n] of mix) for (let i = 0; i < n; i++) log.push(shapes[op]());
  return log;
}

// ── candidate transforms (exploration only) ────────────────────────────────
const RESULT_KEY = { game_values: 'v', node: 'n' };
const NODE_KEY = { full_path: 'p', instance_data: 'i' };
const IDATA_KEY = { x: '0', y: '1', charge_start: '2', charge_end: '3', level: '4' };
const remap = (o, m) => {
  if (!o || typeof o !== 'object') return o;
  const out = {};
  for (const k of Object.keys(o)) out[m[k] ?? k] = o[k];
  return out;
};

/** V2: result-wrapper + node key codes. */
function wrapperKeys(c) {
  if (!c.r || typeof c.r !== 'object') return c;
  const r = remap(c.r, RESULT_KEY);
  if (r.n) r.n = remap(r.n, NODE_KEY);
  return { ...c, r };
}
/** V3: V2 + instance_data field codes. */
function idataKeys(c) {
  const v = wrapperKeys(c);
  if (v.r?.n?.i) v.r.n.i = remap(v.r.n.i, IDATA_KEY);
  return v;
}
/** V4: V3 + drop the constant per-history addr (recoverable from selfAddr). */
function dropAddr(c) {
  const v = idataKeys(c);
  const { a, ...rest } = v;
  return rest;
}
/** V5: positional tuple — no envelope keys at all: [o, g, r, t]. */
function tuple(c) {
  const v = idataKeys(c);
  return [v.o, v.g ?? 0, v.r ?? 0, v.t ?? 0];
}

const B = (x) => Buffer.byteLength(JSON.stringify(x), 'utf8');
const pct = (base, x) => `${(((base - x) / base) * 100).toFixed(1)}%`;

describe('codec size exploration: how much do shorter keys buy?', () => {
  const log = buildLog();
  const v0 = log;
  const v1 = log.map(encodeDelta);
  const v2 = v1.map(wrapperKeys);
  const v3 = v1.map(idataKeys);
  const v4 = v1.map(dropAddr);
  const v5 = v1.map(tuple);
  const sum = (a) => a.reduce((s, d) => s + B(d), 0);
  const S = { v0: sum(v0), v1: sum(v1), v2: sum(v2), v3: sum(v3), v4: sum(v4), v5: sum(v5) };

  it('logs the comparative table (the deliverable)', () => {
    const row = (label, n) =>
      `  ${label.padEnd(34)} ${String(n).padStart(9)} B   vs verbose ${pct(S.v0, n).padStart(7)}   vs shipped ${pct(S.v1, n).padStart(7)}`;
    console.log(
      [
        `\n=== Shorter-key exploration (${log.length}-delta realistic session) ===`,
        row('V0 verbose JSON (pre-#292)', S.v0),
        row('V1 shipped codec (#292)', S.v1),
        row('V2 + result/node key codes', S.v2),
        row('V3 + instance_data field codes', S.v3),
        row('V4 + drop constant addr', S.v4),
        row('V5 positional tuple (no keys)', S.v5),
        '',
        'Marginal gain beyond the shipped codec is the decision metric.',
      ].join('\n')
    );
    expect(true).toBe(true);
  });

  it('regression guard: shipped codec beats verbose and variants are monotone', () => {
    expect(S.v1).toBeLessThan(S.v0 * 0.85); // shipped codec ≥15% smaller
    expect(S.v2).toBeLessThanOrEqual(S.v1);
    expect(S.v3).toBeLessThanOrEqual(S.v2);
    expect(S.v4).toBeLessThanOrEqual(S.v3);
    expect(S.v5).toBeLessThanOrEqual(S.v3);
  });
});
