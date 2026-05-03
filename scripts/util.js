// Generic helpers shared across the legacy Game/Render layers.
// jQuery is loaded as a global (vendor/jquery.js via requirejs); read lazily
// from globalThis inside wait() so this module's top-level evaluation does
// not require $ to exist yet.

export function extend(C, P) {
  var F = function() {};
  F.prototype = P.prototype;
  C.prototype = new F();
  C.prototype.constructor = C;
  C.P = P.prototype;
}

export function wait(delay) {
  console.warn('Asynchronously waiting for %s milliseconds.', delay);
  var $ = globalThis.jQuery || globalThis.$;
  var deferred = new $.Deferred();
  setTimeout(function() {
    deferred.resolve();
  }, delay);
  return deferred.promise();
}

export default { extend, wait };
