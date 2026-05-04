// Boot the browser UI: render the loader, await engine replay, hand off
// to app.start.  Imported as a side effect by scripts/esm-entry.ts, so
// the body runs once the bundle IIFE evaluates.

import { getApplication } from './app.js';
import { boot, getBootPromise, getReplayProgress } from './boot.js';

// jQuery's Deferred type is wider than its native Promise — Game.js handlers
// resolve with Deferreds whose `.fail()` arity matches the legacy callbacks.
interface JQueryDeferred {
  fail(handler: (...args: unknown[]) => void): JQueryDeferred;
  then(
    onResolved?: (...args: unknown[]) => unknown,
    onRejected?: (...args: unknown[]) => unknown
  ): JQueryDeferred;
}

type JQueryStatic = (selector: string | Element | Document) => {
  html(content: string): unknown;
};

// In Node (vitest, SSR) there is no DOM and no vendor globals — skip
// the whole UI hand-off so the module is import-safe without jsdom.
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  if (typeof webxdc !== 'undefined') {
    boot();
  }

  const g = globalThis as unknown as { jQuery?: JQueryStatic; $?: JQueryStatic };
  const $ = g.jQuery ?? g.$;
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
    $('#loadertext').html(
      'Sorry, the Game failed to start.<br>' +
        '<small style="opacity:.7">' +
        message +
        (detail ? ': ' + detail : '') +
        '</small>'
    );
  };

  const continueStart = (): void => {
    clearInterval(progressTimer);
    (app.loadViews() as JQueryDeferred).then(
      () => {
        console.info('Starting Game');
        try {
          (app.start() as JQueryDeferred).fail(function (...args) {
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
