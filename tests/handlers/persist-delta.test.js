// @ts-nocheck — strict-TS quarantine; remove when this file is migrated to TS (issue #147)
/**
 * _persistDelta dual-path mutual-exclusion regression.
 *
 * `_persistDelta` historically called both the test `_sendDelta` spy AND
 * `webxdc.sendUpdate` when both were set. In tests that install a real
 * webxdc shim, the shim's listener echoes the update back through
 * applyDelta a second time — double-mutating state.
 *
 * Contract: when `_sendDelta` is set, treat it as the test sink and skip
 * `webxdc.sendUpdate`. Production callers don't call setSendDelta, so the
 * webxdc.sendUpdate path remains the only one in real builds.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buyKarma, setSendDelta } from '../../scripts/LocalEngine.js';
import { setState } from '../../scripts/boot.js';
import { freshState } from '../../scripts/state.js';

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

describe('_persistDelta — spy/webxdc mutual exclusion', () => {
  let savedWebxdc;
  let sendUpdateCalls;

  beforeEach(() => {
    savedWebxdc = globalThis.webxdc;
    sendUpdateCalls = [];
    globalThis.webxdc = {
      selfAddr: 'test@local',
      selfName: 'Test',
      sendUpdate(u) {
        sendUpdateCalls.push(u);
      },
      setUpdateListener() {
        return Promise.resolve();
      },
    };
  });

  afterEach(() => {
    setSendDelta(null);
    globalThis.webxdc = savedWebxdc;
  });

  it('does NOT call webxdc.sendUpdate when _sendDelta spy is set', async () => {
    const captured = [];
    setSendDelta((d) => captured.push(d));
    setState(mkKarmaState());

    await buyKarma('karma001');

    expect(captured.length).toBeGreaterThan(0);
    expect(sendUpdateCalls.length).toBe(0);
  });

  it('DOES call webxdc.sendUpdate when no _sendDelta spy is set', async () => {
    setState(mkKarmaState());

    await buyKarma('karma001');

    expect(sendUpdateCalls.length).toBeGreaterThan(0);
  });
});
