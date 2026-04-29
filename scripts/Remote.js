// Thin shim that delegates remote-method calls to LocalEngine.
// Each registered method returns a jQuery Deferred promise so existing
// .done()/.fail() chains in Game.js and bootstrap.js keep working.

define(function(require) {

  var $ = require('jquery');
  var LocalEngine = require('LocalEngine');

  var Remote = function(options) {
    var remote = this;
    options = options || {};

    // `endpointOverride` and any additional arguments are accepted for
    // backwards compatibility with callers like app.js and bootstrap.js
    // that still pass an endpoint URL or Remote.NEEDS_QUEUE, but they are
    // no longer used now that calls are dispatched locally.
    remote.addMethod = function(name /*, endpointOverride */) {
      if (!name) {
        console.error('Remote.addMethod: method name is required.');
        return remote;
      }
      if (Remote.RESERVED_METHODNAMES.hasOwnProperty(name)) {
        console.error('Cannot add remote method, name "%s" is reserved.', name);
        return remote;
      }
      remote[name] = function() {
        var fn = LocalEngine[name];
        if (typeof fn === 'function') {
          var result = fn.apply(LocalEngine, arguments);
          // LocalEngine handlers return native Promises; wrap in jQuery
          // Deferred so callers using .done()/.fail() (bootstrap.js, Game.js)
          // keep working without modification.
          if (result && typeof result.then === 'function' && typeof result.done !== 'function') {
            var d = $.Deferred();
            result.then(function(v) { d.resolve(v); }, function(e) { d.reject(e); });
            return d.promise();
          }
          return result;
        }
        return $.Deferred().reject('NotImplemented: ' + name).promise();
      };
      return remote;
    };

    return this;
  };

  // Preserved so app.js can still pass `Remote.NEEDS_QUEUE` as it does today.
  Remote.NEEDS_QUEUE = true;

  Remote.RESERVED_METHODNAMES = {addMethod: true, queue: true};

  return Remote;

});
