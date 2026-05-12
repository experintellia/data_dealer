/* Unit-test scaffold — NOT loaded by index.html.
 * index.html uses the mockWebxdc() Vite plugin (@webxdc/vite-plugins) instead.
 *
 * To turn this into a proper Node/vitest mock: drop the localStorage calls and
 * export window.webxdc as a module so tests can import and reset it between runs.
 */
import type { ReceivedStatusUpdate, SendingStatusUpdate } from '@webxdc/types';

(function () {
  if (window.webxdc) return; // real messenger present — nothing to do

  console.log('[webxdc-shim] dev mode');

  const STORAGE_KEY = 'webxdc-shim-updates';
  let _updates: ReceivedStatusUpdate<any>[] = [];
  let _listeners: Array<(u: ReceivedStatusUpdate<any>) => void> = [];

  // Restore persisted history so a page reload replays prior updates.
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      try {
        _updates = JSON.parse(stored);
      } catch (parseErr) {
        // Malformed payload (truncated, hand-edited, schema drift) — drop
        // the history rather than crash, but make the loss observable so a
        // dev notices instead of silently restarting from an empty queue.
        console.warn(
          '[webxdc-shim] failed to parse stored updates; dropping history:',
          parseErr
        );
        _updates = [];
      }
    }
  } catch (storageErr) {
    // localStorage access threw (quota, private browsing, disabled). Degrade
    // to a fresh in-memory queue; log so the dev sees why replay is empty.
    console.warn('[webxdc-shim] localStorage read failed:', storageErr);
  }

  function _persist(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(_updates));
    } catch (storageErr) {
      // Write failures are non-fatal (state still works in-memory for the
      // session), but a silent drop here means a page reload loses progress —
      // surface the cause via console.warn.
      console.warn('[webxdc-shim] localStorage write failed:', storageErr);
    }
  }

  // Cast via `any` — this is a minimal dev scaffold, not a full Webxdc
  // implementation; the real messenger provides all fields at runtime.
  (window as any).webxdc = {
    selfAddr: 'dev@local',
    selfName: 'Dev',

    sendUpdate(update: SendingStatusUpdate<any>, _descr: ''): void {
      const serial = _updates.length + 1;
      // payload and other fields are copied in from `update` below; cast
      // to satisfy the required-payload shape before the loop fills it in.
      const entry = { serial, max_serial: serial } as ReceivedStatusUpdate<any>;
      // Shallow-copy payload fields, then stamp serial on top.
      if (update && typeof update === 'object') {
        Object.keys(update).forEach(function (k) {
          (entry as any)[k] = (update as any)[k];
        });
      }
      entry.serial = serial;
      _updates.push(entry);
      _persist();
      _listeners.forEach(function (cb) {
        cb(entry);
      });
    },

    setUpdateListener(cb: (u: ReceivedStatusUpdate<any>) => void, serial?: number): Promise<void> {
      const after = typeof serial === 'number' ? serial : 0;
      // Replay history that arrived before this listener was registered.
      _updates.forEach(function (u) {
        if (u.serial > after) {
          cb(u);
        }
      });
      _listeners = [cb]; // last registration wins — matches real webxdc contract
      return Promise.resolve();
    },
  };
})();
