/* webxdc dev shim — NOT loaded by index.html (mockWebxdc() Vite plugin handles
 * that now). Kept here as a starting point for a Node-compatible unit-test mock
 * (drop the localStorage calls, export window.webxdc as a module).
 *
 * If you need a plain-file fallback (no Vite), load this before require.js:
 * it no-ops when window.webxdc is already set, otherwise installs a
 * localStorage-backed polyfill.
 */
(function () {
  'use strict';

  if (window.webxdc) return; // real messenger present — nothing to do

  console.log('[webxdc-shim] dev mode');

  var STORAGE_KEY = 'webxdc-shim-updates';
  var _updates = [];
  var _listeners = [];

  // Restore persisted history so a page reload replays prior updates.
  try {
    var stored = localStorage.getItem(STORAGE_KEY);
    if (stored) { _updates = JSON.parse(stored); }
  } catch (_) {}

  function _persist() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(_updates)); } catch (_) {}
  }

  window.webxdc = {
    selfAddr: 'dev@local',
    selfName: 'Dev',

    sendUpdate: function (update, descr) {
      var serial = _updates.length + 1;
      var entry = {};
      // Shallow-copy payload fields, then stamp serial on top.
      if (update && typeof update === 'object') {
        Object.keys(update).forEach(function (k) { entry[k] = update[k]; });
      }
      entry.serial = serial;
      _updates.push(entry);
      _persist();
      _listeners.forEach(function (cb) { cb(entry); });
    },

    setUpdateListener: function (cb, serial) {
      var after = (typeof serial === 'number') ? serial : 0;
      // Replay history that arrived before this listener was registered.
      _updates.forEach(function (u) {
        if (u.serial > after) { cb(u); }
      });
      _listeners = [cb]; // last registration wins — matches real webxdc contract
    }
  };
}());
