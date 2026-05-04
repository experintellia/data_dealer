// Boots the app: render the loader view, await engine replay, hand off
// to app.start().  ESM (issue #58) — formerly an AMD `require([...], cb)`
// shell.  Imported as a side effect by scripts/esm-entry.js, so its
// top-level body runs once the bundle IIFE evaluates, after the vendor
// <script> tags in index.html have populated window.jQuery / window._.

import loaderHtml from '../views/loader.html?raw';
import { getApplication } from './app.js';
import { boot, getBootPromise, getReplayProgress } from './boot.js';

// In Node (vitest/SSR/import-graph snapshot), there is no DOM or vendor
// globals, and this whole UI hand-off path is irrelevant.  Skip it so
// the module is import-safe in test environments without forcing a
// jsdom dependency.
if (typeof window === 'undefined' || typeof document === 'undefined') {
  /* skip browser bootstrap in Node */
} else {
  runBrowserBootstrap();
}

function runBrowserBootstrap() {

// Kick off engine replay as early as possible so setUpdateListener
// registers before any UI code can interleave.  boot() is idempotent
// (returns the in-flight promise on subsequent calls), and is also a
// no-op if the webxdc global is missing (e.g. running outside a host).
if (typeof webxdc !== 'undefined') {
  boot();
}

const $ = globalThis.jQuery || globalThis.$;
const _ = globalThis._;

function showFatal(message, err) {
  console.error('Game start failed:', message, err);
  if (err && err.stack) console.error(err.stack);
  const detail = (err && err.message) || String(err || '');
  $('#loadertext').html(
    'Sorry, the Game failed to start.<br>' +
    '<small style="opacity:.7">' + message + (detail ? ': ' + detail : '') + '</small>'
  );
}

// underscore 1.5.1's signature is `_.template(text, data, settings)`;
// passing settings as the second argument renders eagerly.  Pass null
// for data so we get a precompiled function back.
const loaderView = _.template(loaderHtml, null, { variable: 'D' });
$('#dd-control').html(loaderView({}));

// While the engine replays history, drive the loader's progress bar from
// boot.getReplayProgress(). max_serial can grow as live peer updates land
// mid-replay, so the bar may not visually fill — that's fine; the game
// still starts at the resolution of the listener promise.
const loaderEl = document.getElementById('loader');
let progressTimer = setInterval(function () {
  const p = getReplayProgress();
  if (loaderEl) {
    if (p.max_serial > 0) {
      loaderEl.value = p.serial;
      loaderEl.max   = p.max_serial;
    }
  }
  if (p.done) {
    if (loaderEl && p.max_serial > 0) loaderEl.value = loaderEl.max;
    clearInterval(progressTimer);
  }
}, 100);

function continueStart() {
  clearInterval(progressTimer);
  const app = getApplication();
  app.loadViews().then(function() {
    console.info('Starting Game');
    try {
      app.start().fail(function() {
        showFatal('app.start rejected', arguments.length ? arguments[0] : null);
      });
    } catch (err) {
      showFatal('app.start threw', err);
    }
  }, function(err) {
    showFatal('app.loadViews rejected', err);
  });
}

// boot() was kicked off synchronously above.  If for some reason there
// is no promise to await (e.g. running outside a webxdc host), fall
// through to the start path immediately.
const bootPromise = getBootPromise();
if (bootPromise && typeof bootPromise.then === 'function') {
  bootPromise.then(continueStart, function (err) {
    clearInterval(progressTimer);
    showFatal('engine replay failed', err);
  });
} else {
  continueStart();
}

}  // end runBrowserBootstrap
