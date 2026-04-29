// native-console: no-op shim — every browser we target ships window.console.
// Kept as a requirejs module so legacy require('native-console') still resolves.
(function(root, factory) {
  if (typeof define === 'function' && define.amd) { define([], factory); }
  else { factory(); }
}(this, function() { /* console already present */ }));
