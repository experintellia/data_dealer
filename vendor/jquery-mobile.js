// jquery-mobile — stub so require('jquery-mobile') resolves without errors.
// The game only uses jQM for mobile-specific UI; it is only loaded after
// a successful getToken(), which never happens in the boots-to-broken state.
// Replace with the real jquery-mobile build when restoring full game functionality.
(function(global, factory) {
  if (typeof define === 'function' && define.amd) {
    define(['jquery'], factory);
  } else {
    factory(global.jQuery || global.$);
  }
}(this, function($) {
  if ($ && $.mobile === undefined) {
    $.mobile = { version: '1.3.2-stub' };
  }
}));
