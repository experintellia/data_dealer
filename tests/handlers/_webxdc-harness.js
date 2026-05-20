// @ts-nocheck — strict-TS quarantine; remove when this file is migrated to TS (issue #147)
/**
 * Synchronous fake-webxdc harness for handler unit tests.
 *
 * Canonical webxdc (post #120 follow-up): handlers only `webxdc.sendUpdate`;
 * the SOLE state mutation site is the `setUpdateListener` callback registered
 * by scripts/boot.ts. The real messenger delivers updates asynchronously, but
 * for deterministic unit tests this fake delivers the update to the registered
 * listener SYNCHRONOUSLY inside `sendUpdate`. State still mutates only in the
 * listener (via applyDelta) — exactly the production path — just without the
 * messenger's async hop.
 *
 * Usage in a handler test file:
 *
 *   import { installWebxdc, uninstallWebxdc, setSendDelta } from './_webxdc-harness.js';
 *   beforeEach(async () => { await installWebxdc(); });
 *   afterEach(() => uninstallWebxdc());
 *
 * `setSendDelta` is a capture-only spy (it does NOT mutate state and is NOT in
 * production code) kept so the pre-existing delta-capture/idempotence tests
 * migrate with only an import-path change. It receives the VERBOSE delta
 * payload, identical to what the old LocalEngine `_sendDelta` sink received.
 */
import { __resetBootForTest, boot } from '../../scripts/boot.js';
import { __resetAvatarsForTest } from '../../scripts/webxdc-avatars.js';

const SELF_ADDR = 'test@local';

let _savedWebxdc;
let _captureCb = null;
let _sent = []; // raw on-the-wire payloads, in send order

function _makeFakeWebxdc() {
  const updates = [];
  let listener = null;
  return {
    selfAddr: SELF_ADDR,
    selfName: 'Test',
    sendUpdate(update, _descr) {
      const serial = updates.length + 1;
      const entry = Object.assign({}, update, { serial, max_serial: serial });
      updates.push(entry);
      _sent.push(update && update.payload);
      const decoded = update && update.payload;
      if (_captureCb && decoded && decoded.kind === 'delta') {
        _captureCb(decoded);
      }
      // Canonical mutation site: deliver to the listener boot() registered.
      if (listener) listener(entry);
    },
    setUpdateListener(cb, serial) {
      const after = typeof serial === 'number' ? serial : 0;
      for (const u of updates) {
        if (u.serial > after) cb(u);
      }
      listener = cb; // last registration wins — matches real webxdc
      return Promise.resolve();
    },
  };
}

/**
 * Install a fresh synchronous fake-webxdc on globalThis and re-run boot() so
 * the canonical listener is registered against it. Call in `beforeEach`.
 */
export async function installWebxdc() {
  _savedWebxdc = globalThis.webxdc;
  _captureCb = null;
  _sent = [];
  globalThis.webxdc = _makeFakeWebxdc();
  __resetBootForTest();
  __resetAvatarsForTest();
  await boot({ selfAddr: SELF_ADDR });
}

/** Restore the previous global and clear boot/capture state. Call in `afterEach`. */
export function uninstallWebxdc() {
  _captureCb = null;
  _sent = [];
  __resetBootForTest();
  __resetAvatarsForTest();
  if (_savedWebxdc === undefined) {
    delete globalThis.webxdc;
  } else {
    globalThis.webxdc = _savedWebxdc;
  }
}

/**
 * Capture-only spy. `setSendDelta(fn)` registers fn(verboseDelta); the fake
 * messenger calls it for every delta-kind update sent. `setSendDelta(null)`
 * clears it. Does not affect state — the listener is still the only mutator.
 */
export function setSendDelta(fn) {
  _captureCb = typeof fn === 'function' ? fn : null;
}

/** All delta-kind payloads sent so far, decoded to verbose form (send order). */
export function sentDeltas() {
  return _sent.filter((d) => d && d.kind === 'delta');
}

/** Raw on-the-wire payloads sent so far (send order), including achievements. */
export function sentPayloads() {
  return _sent.slice();
}
