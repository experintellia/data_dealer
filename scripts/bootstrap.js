// Boots the app: render the loader view, fetch a session token, then
// hand off to app.loadViews() / app.start().  The original code routed
// through hash-based routie routes (#load, #downtime); both are dead
// in the webxdc port because the local engine never rejects getToken.
require([
  'require',
  'jquery',
  'Remote',
  'i18n',
  'setup',
  'app',
  'native-console',
  'tpl!../views/loader.html'
], function(require) {

  var $ = require('jquery');
  var Remote = require('Remote');
  var setup = require('setup');

  var remote = new Remote({endPoint: setup.jsonRpcUrl});
  remote.addMethod('getToken');

  function showFatal(message, err) {
    console.error('Game start failed:', message, err);
    if (err && err.stack) console.error(err.stack);
    var detail = (err && err.message) || String(err || '');
    $('#loadertext').html(
      'Sorry, the Game failed to start.<br>' +
      '<small style="opacity:.7">' + message + (detail ? ': ' + detail : '') + '</small>'
    );
  }

  remote.getToken().done(function(data) {
    console.info('We got a token:', data.result);
    var view = require('tpl!../views/loader.html');
    $('#dd-control').html(view());

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
  }).fail(function(err) {
    showFatal('getToken rejected', err);
  });
});
