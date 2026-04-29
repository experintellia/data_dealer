// zynga-animate — Animate.js from zynga/scroller (commit 7d460ea).
// Provides requestAnimationFrame-based animation scheduling used by zynga-scroller.
// Source: https://github.com/zynga/scroller/blob/7d460ea/src/Animate.js
// Vendored because neither npm nor bower have this at the exact pinned commit.
(function(global, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], function() { return factory(global); });
  } else {
    global.core = factory(global);
  }
}(this, function(global) {
  var time = Date.now || function() { return +new Date(); };
  var desiredFrames = 60;
  var millisecondsPerSecond = 1000;
  var running = {};
  var counter = 1;

  return {
    requestAnimationFrame: (function() {
      var requestFrame = global.requestAnimationFrame ||
        global.webkitRequestAnimationFrame ||
        global.mozRequestAnimationFrame ||
        global.oRequestAnimationFrame ||
        function(callback) { global.setTimeout(callback, 1000 / desiredFrames); };
      var isNative = !!global.requestAnimationFrame;
      if (isNative) {
        return function(callback, root) { return requestFrame(callback, root); };
      }
      return function(callback) {
        var id = counter++;
        var start = time();
        running[id] = true;
        requestFrame(function step() {
          if (running[id]) {
            running[id] = callback(time() - start);
            if (running[id]) { requestFrame(step); }
          }
        });
        return id;
      };
    })(),

    stop: function(id) {
      var cleared = running[id] != null;
      if (cleared) { running[id] = null; }
      return cleared;
    },

    isRunning: function(id) { return running[id] != null; },

    start: function(stepCallback, verifyCallback, completedCallback, duration, easingMethod, root) {
      var start = time();
      var lastFrame = start;
      var percent = 0;
      var dropCounter = 0;
      var id = counter++;
      if (!verifyCallback) { verifyCallback = function() { return true; }; }
      if (!root || !root.offsetWidth) { root = document.body; }

      running[id] = true;
      this.requestAnimationFrame(function step(virtual) {
        var render = virtual > 0;
        var now = time();
        if (!running[id]) { return; }
        if (!verifyCallback(id)) { running[id] = null; return; }
        if (duration) {
          percent = (now - start) / duration;
          if (percent > 1) { percent = 1; }
        }
        var value = easingMethod ? easingMethod(percent) : percent;
        if ((stepCallback(value, now, render) === false || percent === 1) && render) {
          running[id] = null;
          if (completedCallback) { completedCallback(desiredFrames - (dropCounter / ((now - start) / millisecondsPerSecond)), id, percent === 1 || duration == null); }
        } else if (render) {
          lastFrame = now;
          this.requestAnimationFrame(step, root);
        }
      }, root);
      return id;
    }
  };
}));
