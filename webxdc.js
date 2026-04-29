/* webxdc.js — dev simulator for plain-browser development.
 *
 * Delta Chat intercepts the <script src="webxdc.js"> request and serves its
 * own implementation, so this file never runs inside a real messenger.
 * Outside Delta Chat (file://, python3 -m http.server, Codespace devserver)
 * this file is served as-is and installs a localStorage-backed polyfill so
 * the game boots without requiring Delta Chat for every dev iteration.
 *
 * Guard is kept so a second include or future injection still no-ops cleanly.
 */
(function () {
  'use strict';

  if (window.webxdc) return;

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
      _updates.forEach(function (u) {
        if (u.serial > after) { cb(u); }
      });
      _listeners.push(cb);
    }
  };
}());
