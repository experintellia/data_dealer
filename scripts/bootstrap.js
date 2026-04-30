// Some ugly spaghetti code to get the app running in magical order and put routie routes in place.
// FIXME: yes. Also get rid of routie.
require([
  'require',
  'jquery',
  'Remote',
  'i18n',
  'routie',
  'setup',
  'app',
  'native-console',
  'tpl!../views/loader.html',
  'tpl!../views/downtime.html'
], function(require) {

  var $ = require('jquery');

  var Remote = require('Remote');

  var setup = require('setup');

  var remote = new Remote({endPoint: setup.jsonRpcUrl});
  remote.addMethod('getToken');

  var loadGameViewsAndStart = function(){
    var app = require('app').getApplication();
    app.loadViews().then(function() {
      console.info('Starting Game');
      app.start().fail(function(){
        console.warn('This game start has proudly failed, but do not worry...');
        $('#loadertext').text('Sorry, the Game failed to start.<br />Restarting...');
        location.href = "/";
      });
    });
  };

  // register some routes

  var routie_routes = {};
  routie_routes['load'] = function() {
    remote.getToken().done(function(data) {
      console.info('We got a token:', data.result);
      var view = require('tpl!../views/loader.html');
      $('#dd-control').html(view());
      // The original game ran a PreloadJS asset-manifest warmup pass here
      // before starting the engine. The webxdc bundle ships every asset
      // locally, so there is nothing to warm — start the game directly.
      loadGameViewsAndStart();
    }).fail(function(data) {
      console.error('Error: ',data);
      console.error('Backend made a  bubu, do something!');
      routie('downtime');
    });
  };
  routie_routes['downtime'] = function() {
    var view = require('tpl!../views/downtime.html');
    $('#dd-control').html(view());
  };

  // -----------------------------------------------------------------------------------
  // ^- desperately slashing at the spaghetti, trying to kill it, but all to no avail.

  // finally do it:

  // routie endpoint, so reassign route handlers
  routie.removeAll(); // just in case?
  routie(routie_routes);

  // FIXME: Starting with #load
  if (!location.hash) {
    routie('load');
  }
});
