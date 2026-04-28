// Local replacement for the back-end JSON-RPC service.
// Phase 2 only provides stubs: every method rejects with "NotImplemented".
// Phase 3 issues will fill these in with real client-side handlers.

define(function(require) {

  var $ = require('jquery');

  // RPC names registered in app.js:140-159.
  var names = [
    'buyPowerup',
    'chargePerp',
    'collectPerp',
    'integrateCollected',
    'getPowerups',
    'getProvidedPerps',
    'getSessionLocale',
    'buyKarma',
    'buyPerp',
    'buySlots',
    'getToken',
    'loadGame',
    'setDisplayName',
    'getRanking',
    'ping',
    'resetGame',
    'sellPowerup',
    'setPerpCoordinates',
    'checkUsername'
  ];

  var LocalEngine = {};

  names.forEach(function(name) {
    LocalEngine[name] = function() {
      return $.Deferred().reject('NotImplemented: ' + name).promise();
    };
  });

  return LocalEngine;

});
