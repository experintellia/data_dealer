// Boot the browser UI: render the loader, await engine replay, hand off
// to app.start.  Imported as a side effect by scripts/esm-entry.ts, so
// the body runs once the bundle IIFE evaluates.

import { getApplication } from './app.js';
import { boot, getBootPromise, getReplayProgress } from './boot.js';

// In Node (vitest, SSR) there is no DOM and no vendor globals — skip
// the whole UI hand-off so the module is import-safe without jsdom.
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  if (typeof webxdc !== 'undefined') {
    boot();
  }

  const $ = jQuery ?? globalThis.$;
  if (!$) throw new Error('bootstrap.ts: jQuery global not found');
  const app = getApplication();

  $('#dd-control').html(app.renderView('loader.html'));

  const loaderEl = document.getElementById('loader') as HTMLProgressElement | null;
  let lastSerial = -1;
  let lastMax = -1;
  const progressTimer: ReturnType<typeof setInterval> = setInterval(() => {
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

  const showFatal = (message: string, err: unknown): void => {
    console.error('Game start failed:', message, err);
    if (err && typeof err === 'object' && 'stack' in err)
      console.error((err as { stack?: string }).stack);
    const detail =
      err && typeof err === 'object' && 'message' in err
        ? String((err as { message?: unknown }).message)
        : String(err || '');
    // Set the headline via .html() so the <br> renders, then set the detail
    // line via the <small> child's textContent so any attacker-influenced
    // `err.message` contents are treated as a literal string, not parsed as
    // HTML.
    $('#loadertext').html('Sorry, the Game failed to start.<br><small style="opacity:.7"></small>');
    const smallEl = document.querySelector('#loadertext small');
    if (smallEl) smallEl.textContent = message + (detail ? ': ' + detail : '');
  };

  const continueStart = (): void => {
    clearInterval(progressTimer);
    app.loadViews().then(
      () => {
        console.info('Starting Game');
        try {
          app.start().fail(function (...args) {
            showFatal('app.start rejected', args.length ? args[0] : null);
          });
        } catch (err) {
          showFatal('app.start threw', err);
        }
      },
      (err: unknown) => showFatal('app.loadViews rejected', err)
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
