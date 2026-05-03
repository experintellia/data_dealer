define(function(require) {

  var Application = function() {

    require('native-console');

    var _ = require('underscore');
    var $ = require('jquery');

    var setup = require('setup');
    var LocalEngine = require('LocalEngine');
    var i18n = require('i18n');

    // Here we store the stuff we might need throughout the whole application.
    var app = {
      debug: {}
    };

    // Preload necessary views using the RequireJS `tpl` plug-in.
    app.loadViews = function() {
      var deferred = new $.Deferred();
      require([
        'tpl!../views/game.html',
        'tpl!../views/main.html',
        'tpl!../views/mainmenu.html',
        'tpl!../views/noitems.html',
        'tpl!../views/popup.html',
        'tpl!../views/levelup.html',
        'tpl!../views/popup_mission.html',
        'tpl!../views/popup_mission_complete.html',
        'tpl!../views/mission.html',
        'tpl!../views/mission_goal.html',
        'tpl!../views/mission_goal_small.html',
        'tpl!../views/mission_rewards.html',
        'tpl!../views/topscores.html',
        'tpl!../views/topscore.html',
        'tpl!../views/topscore_list.html',
        'tpl!../views/topscore_rank.html',
        'tpl!../views/notification.html',
        'tpl!../views/notification_item.html',
        'tpl!../views/notification_tutorial.html',
        'tpl!../views/popup_user_data.html',
        'tpl!../views/popup_status.html',
        'tpl!../views/popup_karma.html',
        'tpl!../views/popup_agent.html',
        'tpl!../views/popup_client.html',
        'tpl!../views/popup_contact.html',
        'tpl!../views/popup_proxy.html',
        'tpl!../views/popup_project.html',
        'tpl!../views/popup_pusher.html',
        'tpl!../views/popup_city.html',
        'tpl!../views/popup_cities.html',
        'tpl!../views/popup_profileset.html',
        'tpl!../views/popup_token.html',
        'tpl!../views/values.html',
        'tpl!../views/values_details.html',
        'tpl!../views/values_details_powerup.html',
        'tpl!../views/profileset.html',
        'tpl!../views/profileset_client.html',
        'tpl!../views/profileset_token.html',
        'tpl!../views/perp.html',
        'tpl!../views/agent.html',
        'tpl!../views/client.html',
        'tpl!../views/pusher.html',
        'tpl!../views/powerup.html',
        'tpl!../views/powerup_provided.html',
        'tpl!../views/powerup_free.html',
        'tpl!../views/powerup_locked.html',
        'tpl!../views/buttons_project.html',
        'tpl!../views/selector_powerups.html',
        'tpl!../views/subpop_powerup.html',
        'tpl!../views/subpop_buyslots.html',
        'tpl!../views/subpop_powerup_provided.html',
        'tpl!../views/subpop_perp_provided.html',
        'tpl!../views/subpop_token.html',
        'tpl!../views/subpop_token_upgrade.html',
        'tpl!../views/statusbar.html',
        'tpl!../views/token.html',
        'tpl!../views/token_consumed.html',
        'tpl!../views/db_queue.html'
      ], function() {
        deferred.resolve();
      });
      return deferred.promise();
    };

    // A nice wrapper for rendering underscore templates.
    app.renderView = function(viewName, data) {
      function renderView() {
        var view = require('tpl!../views/' + viewName);
        return view(data || {});
      }
      if (typeof window.TypeError !== 'undefined') { // If we have TypeError, we should have try/catch, too.
        try {
          return renderView();
        } catch(ex) {
          console.warn('Could not render view “%s”: %s', viewName, ex.message);
        }
      } else {
        return renderView();
      }
    };

    // Wrap each LocalEngine handler so callers get a jQuery Deferred —
    // Game.js still uses .done()/.fail() chains.  $.when adopts the native
    // Promise returned by the handler.
    var INTERNAL_API = { setEmitter: 1, setSendDelta: 1, setPrngSeed: 1 };
    app.remote = {};
    Object.keys(LocalEngine).forEach(function (name) {
      if (INTERNAL_API[name]) return;
      var fn = LocalEngine[name];
      if (typeof fn !== 'function') return;
      app.remote[name] = function () {
        return $.when(fn.apply(LocalEngine, arguments));
      };
    });

    app.start = function() {
      LocalEngine.setEmitter(function(ev, pl) {
        $(document).trigger(ev, [pl]);
      });

      $('#loadertext').text('Loading saved game');
      return app.remote.getSessionLocale().then(function(data) {
        var locale = data.result === 'de' ? 'de_AT' : 'en_US';
        i18n.setLocale(locale);
        // type_settings runs gettext at module load — must wait for the
        // locale JSON before requiring Game.
        $('#loadertext').text('Loading translations');
        return i18n.ready().then(function() {
          return app.remote.loadGame().then(function(data) {
            var html = app.renderView('game.html');
            $('#dd-control').html(html);
            var Game = require('Game').getGame();
            var gameData = data.result;
            app.version = gameData.version;
            Game.init(gameData);
            if (setup.debug) {
              window.app = app;
              window.setup = setup;
              window.Game = Game;
              window.Render = require('Render').getRender();
            }
          });
        });
      });
    };

    // Extending Underscore with some helpers for easier templating.
    _.mixin({
      mixindone: function() { return true; },
      game: function(){
        // FIXME: only expose certain functions to _
        if (app.game) { return app.game; }
        else { return {} }
      },
      numeral: require('numeral'),
      // vendor/sprintf.js's anonymous define() shadows its global export, so
      // require('sprintf') returns an object wrapper.  Game.js loads the
      // vendor file (which sets window.sprintf = y) before any _.sprintf
      // call site, so reading from the global is safe here.
      sprintf: window.sprintf,
      renderView: app.renderView,
      pad0: function(number, length) {
        // Fastest implementation according to http://jsperf.com/ways-to-0-pad-a-number
        var N = Math.pow(10, length);
        return number < N ? ('' + (N + number)).slice(1) : '' + number
      },
      crlf2html: function(str) {
        return String(str || '').replace(new RegExp('\r?\n|\r', 'g'), '<br>');
      },
      toKSNum: function(number) {
        // To activate german language set:
        //require('numeral-de');
        //_.numeral.language('de-de');
        return _.numeral(number).format('0,0');
      },
      toTime: function(ms) {
        var date = new Date(ms || 0);
        if (ms >= 3600000) {
          return _.pad0(date.getUTCHours(), 2) + ':' +
                 _.pad0(date.getUTCMinutes(), 2) + ':' +
                 _.pad0(date.getUTCSeconds(), 2);
        } else {
          return _.pad0(date.getUTCMinutes(), 2) + ':' +
                 _.pad0(date.getUTCSeconds(), 2);
        }
      },
      span: function(text,CSSClass) {
        CSSClass = CSSClass || "highlight";
        return '<span class="' + CSSClass + '">' + text + '</span>';
      },
      _: i18n.gettext,
      __: i18n.ngettext
    });



    $(function() {
      // Inject a new style element to define our main sprite image.
      // FIXME: This needs to be modified for retrieving the image path from the back-end.
      $('head').append($('<style type="text/css">')
          .html('.RenderSprite {background-image: url(img/MainSprites.png);}'));
    });

    return app;
  }

  var app;

  return {
    getApplication: function() {
      app = app || new Application();
      return app;
    }
  };

});
