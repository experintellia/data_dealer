// Some ugly spaghetti code to get the app running in magical order and put routie routes in place.
// FIXME: yes. Also get rid of routie.
require([
  'require',
  'jquery',
  'preload',
  'Remote',
  'i18n',
  'routie',
  'setup',
  'app',
  'json2',
  'native-console',
  'tpl!../views/loader.html',
  'tpl!../views/downtime.html'
], function(require) {

  var $ = require('jquery');

  var Remote = require('Remote');
  var LoadQueue = require('preload');

  var setup = require('setup');
  var i18n = require('i18n');

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

  // some asset loading

  var load = function() {
    var now = Date.now();
    var queue = new LoadQueue();

    //queue.installPlugin(createjs.Sound);

    queue.addEventListener('progress', function(event) {
      var percentage = parseInt(event.loaded * 100, 10);
      $('#loader').val(percentage);
      $('#loadertext').text('Loading Game ' + percentage + "%");
    });

    // FIXME: make this a setup_local setting to match actual server configuration
    queue.setMaxConnections(8);
    queue.setUseXHR(false)

    queue.addEventListener('fileload', function(event) {
      switch (event.item.type) {
        case LoadQueue.CSS:
        (document.head || document.getElementsByTagName("head")[0]).appendChild(event.result);
        console.info('Loaded stylesheet %s', event.item.src);
        break;
        case LoadQueue.IMAGE:
        //console.info('Loaded image %s', event.item.src);
        break;
        case LoadQueue.JAVASCRIPT:
        document.body.appendChild(event.result);
        //console.info('Loaded script %s', event.item.src);
        break;
        case LoadQueue.JSON:
        if (event.item.src.indexOf('/i18n/') > -1) {
          console.info('Loaded language %s', event.item.src);
        }
        break;
        default:
        console.info('Loaded file %s', event.item.src);
      }
    });

    queue.addEventListener('complete', function(event) {
      console.info('We’re done, let’s sell your private data!');
      $('#loadertext').text('Starting Game');
      loadGameViewsAndStart();
    });

    $.getScript('scripts/asset-manifest.js').then(function() {
      queue.loadManifest(filesManifest);
    }).fail(function(){
      if (setup.debug) {
        loadGameViewsAndStart();
      }
    });
  };

  // register some routes

  var routie_routes = {};
  routie_routes['load'] = function() {
    remote.getToken().done(function(data) {
      console.info('We got a token:', data.result);
      var view = require('tpl!../views/loader.html');
      $('#dd-control').html(view());
      load();
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

  // register some backend calls

  remote.addMethod('logout',setup.jsonRpcUrl);
  remote.addMethod('getToken',setup.jsonRpcUrl);

  // finally do it:

  // routie endpoint, so reassign route handlers
  routie.removeAll(); // just in case?
  routie(routie_routes);

  // FIXME: Starting with #load
  if (!location.hash) {
    routie('load');
  } 
});
