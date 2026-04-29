// zynga-scroller — Scroller.js from zynga/scroller (commit dadd850).
// Minimal AMD-wrapped stub so require('zynga-scroller') resolves without errors.
// The game's Render.js uses the scroller; it is only loaded after a successful
// getToken(), which never happens in the boots-to-broken state.
// Full source: https://github.com/zynga/scroller/blob/dadd850/src/Scroller.js
(function(global, factory) {
  if (typeof define === 'function' && define.amd) {
    define(['zynga-animate'], function(core) { return factory(global, core); });
  } else {
    global.Scroller = factory(global, global.core);
  }
}(this, function(global, core) {
  var Scroller = function(callback, options) {
    this.__callback = callback;
    this.options = { scrollingX: true, scrollingY: true, animating: true, animationDuration: 250,
      bouncing: true, locking: true, paging: false, snapping: false, zooming: false,
      minZoom: 0.5, maxZoom: 3, speedMultiplier: 1, scrollingComplete: function(){},
      penetrationDeceleration: 0.03, penetrationAcceleration: 0.08 };
    for (var key in options) { this.options[key] = options[key]; }
  };
  Scroller.prototype = {
    setDimensions: function(){},
    setPosition: function(){},
    setSnapSize: function(){},
    activatePullToRefresh: function(){},
    triggerPullToRefresh: function(){},
    finishPullToRefresh: function(){},
    getValues: function(){ return { left:0, top:0, zoom:1 }; },
    getScrollMax: function(){ return { left:0, top:0 }; },
    zoomTo: function(){},
    zoomBy: function(){},
    scrollTo: function(){},
    scrollBy: function(){},
    doMouseZoom: function(){},
    doTouchStart: function(){},
    doTouchMove: function(){},
    doTouchEnd: function(){}
  };
  return Scroller;
}));
