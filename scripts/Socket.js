// In-process event bus that mimics the old SockJS-backed Socket interface.
// Events flow through $(document); the LocalEngine will publish/subscribe on
// the same channel.
define(function(require) {

  var _ = require('underscore');
  var $ = require('jquery');

  var setup = require('setup');

  var Socket = function(path, settings) {
    var self = this;

    if (arguments.length < 2) {
      settings = path;
      path = '';
    }

    settings = _.extend({}, setup, settings);

    var subscriptions = [];

    if (settings.queue) {
      this.queue = $.jqmq(settings.queue);
    }

    this.on = function(eventName, handler, needsQueue) {
      if (!_.isFunction(handler)) {
        console.log('Insufficent arguments, handler is not a function.');
        return this;
      }
      if (needsQueue === Socket.NEEDS_QUEUE) {
        if (this.queue && _.isFunction(this.queue.add)) {
          handler = (function(eventName, handler) {
            return function() {
              self.queue.add({
                context: self,
                handler: handler,
                'arguments': arguments
              });
            };
          }(eventName, handler));
        } else {
          console.error('Cannot queue socket event, no queue defined.');
        }
      }
      var listener = function(event, data) {
        handler.call(self, data);
      };
      $(document).on(eventName, listener);
      subscriptions.push({eventName: eventName, listener: listener});
      return this;
    };

    this.emit = function(eventName, data) {
      $(document).trigger(eventName, data);
      return this;
    };

    this.close = function() {
      while (subscriptions.length) {
        var s = subscriptions.pop();
        $(document).off(s.eventName, s.listener);
      }
      return this;
    };

    setTimeout(function() {
      $(document).trigger('connect');
      $(document).trigger('established');
    }, 0);

    return this;
  };

  Socket.NEEDS_QUEUE = true;

  return Socket;
});
