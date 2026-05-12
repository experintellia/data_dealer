// @ts-nocheck — strict-TS quarantine; remove when this file is migrated to TS (issue #147)
//
// Topscores.extendEventHandlers subscribes to `subscribePeersChanged` to
// refresh the leaderboards on every peer ref change.  Pre-fix the
// returned unsubscribe handle was discarded ("Topscores lives for the
// page lifetime; the unsubscribe is dropped."), so any callers that
// later `remove()` the Topscores GameNode (e.g. unit tests, view
// teardown) leaked the listener — it would keep firing against a
// detached node.
//
// Fix: store the handle on the instance and invoke it from
// GameNode.remove (Topscores override).

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { installFakeJq } from './_jq.js';

installFakeJq();

// Stub boot.subscribePeersChanged to return a tracked unsubscribe handle.
const subscribeCalls = [];
const unsubscribeCalls = [];
vi.mock('../../scripts/boot.js', () => ({
  subscribePeersChanged: (cb) => {
    const handle = () => {
      unsubscribeCalls.push(cb);
    };
    subscribeCalls.push({ cb, handle });
    return handle;
  },
}));

// Render is pulled lazily through GameNode → avoid the circular chain.
vi.mock('../../scripts/Render.js', () => ({ getRender: () => ({}) }));

const { Topscores } = await import('../../scripts/game/Topscores.ts');
const gnMod = await import('../../scripts/game/GameNode.ts');
const { _instances, _ids, clear } = gnMod;

describe('Topscores subscribePeersChanged lifecycle', () => {
  beforeEach(() => {
    subscribeCalls.length = 0;
    unsubscribeCalls.length = 0;
    clear();
    _instances.length = 0;
    for (const k of Object.keys(_ids)) delete _ids[k];
  });

  it('invokes the stored unsubscribe handle on remove()', () => {
    const ts = new Topscores({ id: 'Topscores' });

    expect(subscribeCalls.length).toBe(1);

    ts.remove();

    expect(unsubscribeCalls.length).toBe(1);
    expect(unsubscribeCalls[0]).toBe(subscribeCalls[0].cb);
  });
});
