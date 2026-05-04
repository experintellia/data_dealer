// @ts-nocheck — strict-TS quarantine; remove when this file is migrated to TS (issue #147)
// Boot the browser UI: render the loader, await engine replay, hand off
// to app.start.  Imported as a side effect by scripts/esm-entry.js, so
// the body runs once the bundle IIFE evaluates.

import { getApplication } from './app.js';
import { boot, getBootPromise, getReplayProgress } from './boot.js';

// In Node (vitest, SSR) there is no DOM and no vendor globals — skip
// the whole UI hand-off so the module is import-safe without jsdom.
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  if (typeof webxdc !== 'undefined') {
    boot();
  }

  const $ = globalThis.jQuery || globalThis.$;
  const app = getApplication();

  $('#dd-control').html(app.renderView('loader.html'));

  const loaderEl = document.getElementById('loader');
  let lastSerial = -1;
  let lastMax = -1;
  const progressTimer = setInterval(() => {
    const p = getReplayProgress();
    if (loaderEl && p.max_serial > 0 && (p.serial !== lastSerial || p.max_serial !== lastMax)) {
      loaderEl.value = p.serial;
      loaderEl.max = p.max_serial;
      lastSerial = p.serial;
      lastMax = p.max_serial;
    }
    if (p.done) {
      if (loaderEl && p.max_serial > 0) loaderEl.value = loaderEl.max;
      clearInterval(progressTimer);
    }
  }, 100);

  const showFatal = (message, err) => {
    console.error('Game start failed:', message, err);
    if (err && err.stack) console.error(err.stack);
    const detail = (err && err.message) || String(err || '');
    $('#loadertext').html(
      'Sorry, the Game failed to start.<br>' +
        '<small style="opacity:.7">' +
        message +
        (detail ? ': ' + detail : '') +
        '</small>'
    );
  };

  const continueStart = () => {
    clearInterval(progressTimer);
    app.loadViews().then(
      () => {
        console.info('Starting Game');
        try {
          app.start().fail(function () {
            showFatal('app.start rejected', arguments.length ? arguments[0] : null);
          });
        } catch (err) {
          showFatal('app.start threw', err);
        }
      },
      (err) => showFatal('app.loadViews rejected', err)
    );
  };

  const bootPromise = getBootPromise();
  if (bootPromise && typeof bootPromise.then === 'function') {
    bootPromise.then(continueStart, (err) => {
      clearInterval(progressTimer);
      showFatal('engine replay failed', err);
    });
  } else {
    continueStart();
  }
}
