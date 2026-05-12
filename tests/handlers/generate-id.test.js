// @ts-nocheck — strict-TS quarantine; remove when this file is migrated to TS (issue #147)
/**
 * _generateId collision-resistance regression.
 *
 * The legacy default PRNG seed `0xdeadbeef` produced identical ID streams
 * across peers that booted in the same millisecond, which could collide in
 * realtime sync. The fix: derive the seed from `selfAddr + Date.now()` on
 * first use so two peers with different addresses (or boot times) diverge.
 *
 * Tests that need deterministic replay still call `setPrngSeed(n)` explicitly,
 * so test determinism is preserved (see tests/handlers/collect-integrate.test.js).
 *
 * We exercise `_generateId` through `collectPerp`, which mints a `collect_id`
 * for each db_queue entry via `_generateId()`.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  collectPerp,
  setSendDelta,
  resetPrngSeed,
} from '../../scripts/LocalEngine.js';
import { setState } from '../../scripts/boot.js';
import { setOverride, clearOverride } from '../../scripts/clock.js';
import { freshState } from '../../scripts/state.js';
import { materialize } from '../../scripts/materializer.js';
import { FIXED_NOW, mkChargingEntry, mkGv, mkNode } from './_fixtures.js';

const COLLECT_DUR = 120_000;
const COLLECT_END = FIXED_NOW + COLLECT_DUR;

function mkBase(addr) {
  const base = freshState(addr);
  return Object.assign({}, base, {
    game_values: Object.assign({}, base.game_values, mkGv(), {
      cash_value: 1_000_000,
    }),
  });
}

async function collectIdsForAddr(addr, count) {
  const ids = [];
  for (let i = 0; i < count; i++) {
    const path = `Imperium.City.Agent0.contact${String(i).padStart(3, '0')}`;
    const state = Object.assign({}, mkBase(addr), {
      nodes: [mkNode('ContactPerp', path)],
      nodes_charging: [mkChargingEntry(path, { amount: 5 }, 'ContactPerp')],
    });
    setState(state);
    setOverride(COLLECT_END + 1000);
    const mat = materialize(state, COLLECT_END + 1000);
    setState(mat.state);
    const res = await collectPerp(path);
    const cid = res?.result?.result?.collect_id ?? res?.result?.collect_id;
    if (cid) ids.push(cid);
  }
  return ids;
}

describe('_generateId — selfAddr-derived PRNG seed (collision regression)', () => {
  beforeEach(() => setOverride(FIXED_NOW));
  afterEach(() => {
    setSendDelta(null);
    clearOverride();
  });

  it('two peers with different selfAddr produce non-colliding collect_ids', async () => {
    setSendDelta(() => {});

    // Peer A
    resetPrngSeed('alice@example.com');
    const idsA = await collectIdsForAddr('alice@example.com', 25);

    // Peer B — same boot time (clock overridden), different addr.
    resetPrngSeed('bob@example.com');
    const idsB = await collectIdsForAddr('bob@example.com', 25);

    expect(idsA.length).toBe(25);
    expect(idsB.length).toBe(25);

    const all = new Set([...idsA, ...idsB]);
    expect(all.size).toBe(idsA.length + idsB.length);
  });

  it('resetPrngSeed() with no arg lazy-reads webxdc.selfAddr on next _rng()', async () => {
    setSendDelta(() => {});

    const savedWebxdc = globalThis.webxdc;
    const noopWebxdc = (addr) => ({
      selfAddr: addr,
      selfName: addr,
      sendUpdate() {},
      setUpdateListener() {
        return Promise.resolve();
      },
    });
    try {
      globalThis.webxdc = noopWebxdc('lazy-a@example.com');
      resetPrngSeed();
      const ids1 = await collectIdsForAddr('lazy-a@example.com', 10);

      globalThis.webxdc = noopWebxdc('lazy-b@example.com');
      resetPrngSeed();
      const ids2 = await collectIdsForAddr('lazy-b@example.com', 10);

      const all = new Set([...ids1, ...ids2]);
      expect(all.size).toBe(ids1.length + ids2.length);
    } finally {
      globalThis.webxdc = savedWebxdc;
    }
  });
});
