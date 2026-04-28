// beta.datadealer.com production local settings
// to build, copy these to setup_local.js

define(function() {
  return {
    debug: false,
    userdebug: true,
    domain: 'beta.datadealer.com',
    baseUrl: 'https://beta.datadealer.com',
    ioPort: '443',
    jsonRpcUrl: '/app/api/',
    imageUrl: '/img/',
    wsUrl: 'https://sock-b0.datadealer.com/__sockjs__',
    wsProtocolsWhitelist: ['websocket', 'iframe-eventsource', 'iframe-htmlfile', 'xdr-polling', 'xhr-polling', 'iframe-xhr-polling', 'jsonp-polling'],
    locale: 'de_AT',
    updateQueueMaxSize: 10,
    updateQueueInterval: 5000,
  };
});
