// Boots the app: render the loader view, await engine replay, preload
// templates, hand off to app.start().  The original code routed through
// hash-based routie routes (#load, #downtime) and ran a separate
// remote.getToken() up front to detect a downed backend; in the webxdc
// port the local engine is always available, so we go straight to
// app.start() once boot()'s setUpdateListener promise resolves.
// Preload list: every vendor lib that ESM modules read off the browser
// global (window.jQuery, window._, window.numeral, …) MUST appear here so
// RequireJS has fetched and run its AMD-define side effect before
// app.getApplication() touches it.  In the AMD original, factory-body
// `require('name')` strings were auto-discovered and added to the dep
// list; ESM modules have no such magic so the list is now explicit.
require([
  'require',
  'jquery',
  'underscore',
  'numeral',
  'i18n',
  'setup',
  'app',
  'boot',
  'native-console',
  // sprintf must be preloaded because Game.js's factory body issues a
  // synchronous globalThis.require('sprintf') for its window.sprintf
  // side effect — formerly auto-discovered via RequireJS's CommonJS
  // factory string-scan, which ESM modules do not get.
  'sprintf',
  // 'Game' is now ESM-bundled and registered through the AMD bridge,
  // but RequireJS only resolves a bridged module — i.e. invokes its
  // bridge-factory and caches the result — when something requires it.
  // Listing it here forces resolution before app.start so the
  // synchronous globalThis.require('Game').getGame() in app.js's
  // start path finds it in cache.  Note: the inner Game()-factory
  // body still does NOT run until getGame() is actually invoked.
  'Game',
  // Render is still an AMD `define()` module; its factory body string-
  // scans for zynga-scroller, zynga-animate, createjs-easel/tween/sound
  // so preloading 'Render' transitively preloads them.  Once Render is
  // ported (commit 4) those names will be added explicitly here.
  'Render',
  'tpl!../views/loader.html'
], function(require) {

  var $    = require('jquery');
  var boot = require('boot');

  function showFatal(message, err) {
    console.error('Game start failed:', message, err);
    if (err && err.stack) console.error(err.stack);
    var detail = (err && err.message) || String(err || '');
    $('#loadertext').html(
      'Sorry, the Game failed to start.<br>' +
      '<small style="opacity:.7">' + message + (detail ? ': ' + detail : '') + '</small>'
    );
  }

  var loaderView = require('tpl!../views/loader.html');
  $('#dd-control').html(loaderView());

  // While the engine replays history, drive the loader's progress bar from
  // boot.getReplayProgress(). max_serial can grow as live peer updates land
  // mid-replay, so the bar may not visually fill — that's fine; the game
  // still starts at the resolution of the listener promise.
  var loaderEl = document.getElementById('loader');
  var progressTimer = setInterval(function () {
    var p = boot.getReplayProgress();
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
    var app = require('app').getApplication();
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

  // boot() was kicked off synchronously in esm-entry.js. If for some
  // reason the AMD bridge resolves earlier (no webxdc), there's no
  // promise to await — fall through to the start path immediately.
  var bootPromise = boot.getBootPromise();
  if (bootPromise && typeof bootPromise.then === 'function') {
    bootPromise.then(continueStart, function (err) {
      clearInterval(progressTimer);
      showFatal('engine replay failed', err);
    });
  } else {
    continueStart();
  }
});
