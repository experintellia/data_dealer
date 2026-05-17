// Compact wire codec for the persisted delta log.
//
// Why this exists
// ───────────────
// Every state-mutating handler appends a `Delta` via webxdc.sendUpdate, and
// the full history is replayed from serial 0 on every cold start (see
// scripts/state.ts / scripts/boot.ts). The verbose envelope repeats the same
// long keys ("kind"/"addr"/"op"/"args"/"result"/"ts") on every entry; on a
// long-lived game that overhead dominates the persisted JSON and, in the dev
// simulator, blows the localStorage quota (the original crash this addresses).
//
// encodeDelta() rewrites the envelope to single-letter keys + a numeric op
// code before it goes over webxdc.sendUpdate. decodeDelta() is the inverse and
// runs at the single read choke point (applyDelta).
//
// Backward compatibility is MANDATORY, not optional: a real Delta Chat
// sendUpdate history is immutable and append-only, so after this ships a
// returning player replays a mix of legacy verbose deltas (written by older
// builds) and new compact ones. decodeDelta() therefore accepts BOTH shapes
// and passes any non-delta payload (e.g. {kind:'achievement'}) through
// untouched. It is also idempotent on already-verbose input so feeding a
// hand-built verbose delta straight into applyDelta keeps working in tests.
//
// Wire-format stability contract
// ──────────────────────────────
// The maps below ARE the wire format. Treat them as append-only:
//   • never change an existing field letter,
//   • never renumber or reuse an existing op code.
// Adding a new op = add a new entry with the next free integer. An op missing
// from OP_CODE still round-trips correctly — it is just carried as its raw
// string instead of a code, costing a few bytes until a code is assigned.
//
// No DOM/webxdc globals here — pure and unit-testable under the Node test env.

import type { Delta } from './state.js';

// ---------------------------------------------------------------------------
// Wire-format constants (single source of truth)
// ---------------------------------------------------------------------------

/**
 * Verbose `Delta` field name → compact single-letter key.
 *
 * Kept as a named constant rather than inlined so the mapping is greppable
 * and reviewable in one place. `args` maps to `g` because `a` is taken by
 * `addr`.
 */
export const DELTA_FIELD = {
  kind: 'k',
  addr: 'a',
  op: 'o',
  args: 'g',
  result: 'r',
  ts: 't',
  locale: 'l',
} as const;

/**
 * Compact discriminator carried in `k`. Mirrors verbose `Delta.kind ===
 * 'delta'`; a payload without `kind` and with `k === 'd'` is a compact delta.
 */
export const COMPACT_DELTA_TAG = 'd';

/**
 * Stable op-name → numeric code map. APPEND-ONLY (see file header).
 *
 * Mirrors scripts/state.ts `OP_NAMES`; the drift test
 * (tests/state/delta-codec.test.js) fails if state.ts gains an op that has no
 * code here, so the two never silently diverge.
 */
export const OP_CODE: Readonly<Record<string, number>> = {
  loadGame: 1,
  setPerpCoordinates: 2,
  integrateCollected: 3,
  collectPerp: 4,
  chargePerp: 5,
  buySlots: 6,
  buyKarma: 7,
  buyPerp: 8,
  getProvidedPerps: 9,
  sellPowerup: 10,
  buyPowerup: 11,
  getPowerups: 12,
  setDisplayName: 13,
  getRanking: 14,
  getToken: 15,
  getSessionLocale: 16,
  ping: 17,
  checkUsername: 18,
  setLocale: 19,
  dismissMissionBriefing: 20,
  markTokenSeen: 21,
  recheckMissions: 22,
};

/** Reverse of OP_CODE, derived once at module load. */
const CODE_OP: Readonly<Record<number, string>> = (function () {
  const m: Record<number, string> = {};
  for (const [name, code] of Object.entries(OP_CODE)) {
    m[code] = name;
  }
  return m;
})();

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Compact on-the-wire form of `Delta`.
 *
 * `o` is the numeric op code when the op is known, or the raw op string as a
 * graceful fallback for ops not (yet) in OP_CODE. Optional fields are present
 * only when the source `Delta` carried them, so empty fields cost nothing.
 */
export interface CompactDelta {
  k: typeof COMPACT_DELTA_TAG;
  a: string;
  o: number | string;
  g?: unknown[];
  r?: unknown;
  t?: number;
  l?: string;
}

// ---------------------------------------------------------------------------
// Encode
// ---------------------------------------------------------------------------

/**
 * encodeDelta(delta) → CompactDelta
 *
 * Lossless: decodeDelta(encodeDelta(d)) deep-equals d (optional fields that
 * were `undefined` on the input are simply absent on both sides).
 */
export function encodeDelta(delta: Delta): CompactDelta {
  const code = Object.prototype.hasOwnProperty.call(OP_CODE, delta.op)
    ? (OP_CODE[delta.op] as number)
    : delta.op;

  const out: CompactDelta = {
    k: COMPACT_DELTA_TAG,
    a: delta.addr,
    o: code,
  };
  if (delta.args !== undefined) out.g = delta.args;
  if (delta.result !== undefined) out.r = delta.result;
  if (delta.ts !== undefined) out.t = delta.ts;
  if (delta.locale !== undefined) out.l = delta.locale;
  return out;
}

// ---------------------------------------------------------------------------
// Decode
// ---------------------------------------------------------------------------

function decodeOp(o: unknown): string {
  if (typeof o === 'number') {
    const name = CODE_OP[o];
    return name !== undefined ? name : String(o);
  }
  return typeof o === 'string' ? o : String(o);
}

/**
 * decodeDelta(payload) → verbose Delta | original payload
 *
 * Tolerant by design (see file header):
 *   • not an object            → returned unchanged
 *   • has `kind` (verbose)     → returned unchanged (legacy delta, achievement,
 *                                or any other non-compact payload)
 *   • `k === 'd'` (compact)    → expanded to a verbose Delta
 *   • anything else            → returned unchanged
 *
 * Idempotent on verbose deltas, so callers can decode unconditionally.
 */
export function decodeDelta(payload: unknown): unknown {
  if (!payload || typeof payload !== 'object') return payload;
  const p = payload as Record<string, unknown>;

  // Verbose delta / achievement / any other tagged payload: leave it for
  // applyDelta's existing guards to handle.
  if (p.kind !== undefined) return payload;
  if (p.k !== COMPACT_DELTA_TAG) return payload;

  const out: Delta = {
    kind: 'delta',
    addr: typeof p.a === 'string' ? p.a : '',
    op: decodeOp(p.o),
  };
  if (p.g !== undefined) out.args = p.g as unknown[];
  if (p.r !== undefined) out.result = p.r;
  if (typeof p.t === 'number') out.ts = p.t;
  if (typeof p.l === 'string') out.locale = p.l;
  return out;
}
