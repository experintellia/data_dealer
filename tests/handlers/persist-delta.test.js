// @ts-nocheck — strict-TS quarantine; remove when this file is migrated to TS (issue #147)
/**
 * _persistDelta send-only contract (canonical webxdc).
 *
 * Post #120 follow-up: handlers NEVER mutate state. `_persistDelta` only calls
 * `webxdc.sendUpdate` with the compact wire payload; the SOLE state-mutation
 * site is the setUpdateListener callback registered by scripts/boot.ts. This
 * matches real Delta Chat, where the messenger delivers updates (including the
 * sender's own) asynchronously. The previous dual spy/webxdc sink — which
 * mutated state synchronously and only worked because the old localStorage
 * simulator echoed synchronously — has been removed.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buyKarma } from '../../scripts/LocalEngine.js';
import { getState, setState } from '../../scripts/boot.js';
import { clearOverride, setOverride } from '../../scripts/clock.js';
import { decodeDelta } from '../../scripts/delta-codec.js';
import { applyDelta, freshState } from '../../scripts/state.js';
import { FIXED_NOW } from './_fixtures.js';
import {
  installWebxdc,
  sentDeltas,
  sentPayloads,
  setSendDelta,
  uninstallWebxdc,
} from './_webxdc-harness.js';

function mkKarmaState() {
  const base = freshState('test@local');
  return Object.assign({}, base, {
    game_values: Object.assign({}, base.game_values, {
      xp_value: 1,
      xp_level: 1,
      cash_value: 1000,
      cash_spent: 0,
      karma_value: 50,
      profiles_value: 0,
      profiles_max: 1,
      ap_snapshot: 6,
      ap_update: null,
    }),
  });
}

describe('_persistDelta — send-only, listener is the sole mutator', () => {
  beforeEach(async () => {
    await installWebxdc();
    setOverride(FIXED_NOW); // pin clock so applyDelta's skew guard is deterministic
  });
  afterEach(() => {
    clearOverride();
    uninstallWebxdc();
  });

  it('sends exactly one compact delta over webxdc.sendUpdate', async () => {
    setState(mkKarmaState());

    await buyKarma('karma001');

    const payloads = sentPayloads();
    expect(payloads).toHaveLength(1);
    // Compact wire form: single-letter tag `k:'d'`, never the verbose `kind`.
    expect(payloads[0].k).toBe('d');
    expect(payloads[0].kind).toBeUndefined();
    const decoded = decodeDelta(payloads[0]);
    expect(decoded.kind).toBe('delta');
    expect(decoded.op).toBe('buyKarma');
  });

  it('mutates state ONLY via the listener applying the sent delta', async () => {
    setState(mkKarmaState());
    const pre = getState();

    await buyKarma('karma001');

    // Post-state must equal the pre-state with exactly the sent delta applied
    // once — i.e. nothing mutated state except the listener. (applyDelta is
    // pure; the codec round-trips losslessly.)
    const expected = applyDelta(pre, sentPayloads()[0]);
    expect(getState()).toEqual(expected);
    expect(getState().game_values.karma_value).not.toBe(pre.game_values.karma_value);
  });

  it('setSendDelta capture spy still receives the verbose delta', async () => {
    const captured = [];
    setSendDelta((d) => captured.push(d));
    setState(mkKarmaState());

    await buyKarma('karma001');

    expect(captured).toHaveLength(1);
    expect(captured[0].kind).toBe('delta');
    expect(captured[0].op).toBe('buyKarma');
    // The spy sees the same delta the wire carries, decoded.
    expect(captured[0]).toEqual(sentDeltas()[0]);
  });
});
