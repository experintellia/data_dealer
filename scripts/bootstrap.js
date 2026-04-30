// Boots the app: render the loader view, preload templates, hand off
// to app.start().  The original code routed through hash-based routie
// routes (#load, #downtime) and ran a separate remote.getToken() up
// front to detect a downed backend; in the webxdc port the local
// engine is always available, so we go straight to app.start().
require([
  'require',
  'jquery',
  'i18n',
  'setup',
  'app',
  'native-console',
  'tpl!../views/loader.html'
], function(require) {

  var $ = require('jquery');

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
});
