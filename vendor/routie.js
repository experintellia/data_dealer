// routie — minimal SPA hash-router compatible with joestrong/routie 0.3.2 API.
// API used in this project: routie(map), routie(name), routie.removeAll()
(function(root, factory) {
  if (typeof define === 'function' && define.amd) { define([], factory); }
  else if (typeof module !== 'undefined') { module.exports = factory(); }
  else { root.routie = factory(); }
}(this, function() {
  var routes = {};

  function routie(map, handler) {
    if (typeof map === 'string' && typeof handler === 'function') {
      routes[map] = handler;
    } else if (typeof map === 'object') {
      for (var key in map) { if (map.hasOwnProperty(key)) routes[key] = map[key]; }
    } else if (typeof map === 'string') {
      var fn = routes[map];
      if (fn) fn();
      if (typeof history !== 'undefined' && history.pushState) {
        history.pushState(null, '', '#' + map);
      } else if (typeof location !== 'undefined') {
        location.hash = '#' + map;
      }
    }
  }

  routie.removeAll = function() { routes = {}; };

  if (typeof window !== 'undefined') {
    window.addEventListener('hashchange', function() {
      var hash = location.hash.replace(/^#\/?/, '');
      if (routes[hash]) routes[hash]();
    });
  }

  return routie;
}));
