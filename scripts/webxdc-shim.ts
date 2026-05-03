/* Unit-test scaffold — NOT loaded by index.html.
 * index.html uses the mockWebxdc() Vite plugin (@webxdc/vite-plugins) instead.
 *
 * To turn this into a proper Node/vitest mock: drop the localStorage calls and
 * export window.webxdc as a module so tests can import and reset it between runs.
 */
(function () {
  'use strict';

  if (window.webxdc) return; // real messenger present — nothing to do

  console.log('[webxdc-shim] dev mode');

  const STORAGE_KEY = 'webxdc-shim-updates';
  let _updates: ReceivedUpdate[] = [];
  let _listeners: Array<(u: ReceivedUpdate) => void> = [];

  // Restore persisted history so a page reload replays prior updates.
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) { _updates = JSON.parse(stored); }
  } catch (_) {}

  function _persist(): void {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(_updates)); } catch (_) {}
  }

  window.webxdc = {
    selfAddr: 'dev@local',
    selfName: 'Dev',

    sendUpdate(update: WebxdcSendUpdate, _descr?: string): void {
      const serial = _updates.length + 1;
      const entry: ReceivedUpdate = { serial };
      // Shallow-copy payload fields, then stamp serial on top.
      if (update && typeof update === 'object') {
        Object.keys(update).forEach(function (k) {
          (entry as any)[k] = (update as any)[k];
        });
      }
      entry.serial = serial;
      _updates.push(entry);
      _persist();
      _listeners.forEach(function (cb) { cb(entry); });
    },

    setUpdateListener(cb: (u: ReceivedUpdate) => void, serial?: number): Promise<void> {
      const after = (typeof serial === 'number') ? serial : 0;
      // Replay history that arrived before this listener was registered.
      _updates.forEach(function (u) {
        if (u.serial > after) { cb(u); }
      });
      _listeners = [cb]; // last registration wins — matches real webxdc contract
      return Promise.resolve();
    }
  };
}());
