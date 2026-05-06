// @ts-nocheck — strict-TS quarantine; remove when this file is migrated to TS (issue #147)
import { getRender } from './Render.js';
// Vendor libs ($, _, sprintf) are read off globalThis at factory-body
// time, not at module-evaluation time, so this module can be bundled
// alongside scripts that run before vendor `<script>` tags execute.
import appModule from './app.js';
import * as bootMod from './boot.js';
import { AgentPerp } from './game/AgentPerp.js';
import { CityPerp } from './game/CityPerp.js';
import { ClientPerp } from './game/ClientPerp.js';
import { ContactPerp } from './game/ContactPerp.js';
import { Database } from './game/Database.js';
import { DatabasePerp } from './game/DatabasePerp.js';
import {
  GameNode,
  _ids,
  _instances,
  add,
  clear,
  eachByGestalt,
  get,
  getAllByGestalt,
  getByFirstId,
  getByGestalt,
  getById,
  getByLastId,
  getByType,
  getFirstId,
  getGestalt,
  getLastId,
  getParentFromPath,
  getParentId,
  remove,
} from './game/GameNode.js';
import { GamePerp, setAniTicker } from './game/GamePerp.js';
import { GameRoot, setAPTickerForGameRoot, setAniTickerForGameRoot } from './game/GameRoot.js';
import { Imperium } from './game/Imperium.js';
import { Mission } from './game/Mission.js';
import { Missions } from './game/Missions.js';
import { OrderedSet } from './game/OrderedSet.js';
import { ProfileSet } from './game/ProfileSet.js';
import { ProjectPerp } from './game/ProjectPerp.js';
import { ProxyPerp } from './game/ProxyPerp.js';
import { PusherPerp } from './game/PusherPerp.js';
import { SupertokenPerp } from './game/SupertokenPerp.js';
import { TokenPerp } from './game/TokenPerp.js';
import { Topscore } from './game/Topscore.js';
import { Topscores } from './game/Topscores.js';
import { mergeData } from './game/mergeData.js';
import './game/perpCtors.js';
import i18n from './i18n.js';
import setup from './setup.js';
import { getTypeSettings } from './type_settings.js';
import utilDefault from './util.js';
import webxdcIdentity from './webxdc-identity.js';

var Game = function () {
  var _ = globalThis._;
  var $ = globalThis.jQuery || globalThis.$;
  var sprintf = window.sprintf;

  var app = appModule.getApplication();
  var extend = utilDefault.extend;
  var Render = getRender();
  var typeSettings = getTypeSettings();

  // Legacy in-IIFE alias for the extracted ordered-collection class.
  // See scripts/game/OrderedSet.ts for the full contract; the rest of
  // this file calls `new Set()` to retain the historical name.
  // biome-ignore lint/suspicious/noShadowRestrictedNames: legacy collection class predates ES6 Set
  var Set = OrderedSet;

  //////////////////////////////////////////
  //
  // The Game API
  //
  // Instantiates a tree like structure of
  // game controllers, talks to the backend
  // and make use of the Render.js API
  //
  // Here be dragons...
  //
  //////////////////////////////////////////

  /////////////////////////////////////////////
  // Some generic tools and getter functions
  /////////////////////////////////////////////
  //
  // _instances / _ids registry + add/get/remove/clear were extracted to
  // scripts/game/GameNode.ts so the GameNode base class can mutate them
  // without an IIFE-closure round-trip.  The imports above bring them in
  // as live bindings; the in-IIFE call sites below keep the legacy names.

  var init = function (data) {
    // Inits GameRoot as a Singleton, for now.
    app.game = new GameRoot();
    app.game.loadGame(data);
    return app.game;
  };

  //////////////////////////////////////////
  // Some helpers
  //////////////////////////////////////////
  //
  // The id-/gestalt-/path-lookup helpers (getById, getByGestalt,
  // getAllByGestalt, eachByGestalt, getByType, getLastId, getByLastId,
  // getParentId, getParentFromPath, getFirstId, getByFirstId, getGestalt)
  // were extracted to scripts/game/GameNode.ts so subclass extractions
  // (Topscores/Missions/etc.) can import them without bouncing back
  // through the IIFE.  The imports above bring them in as live bindings;
  // the in-IIFE call sites below keep using the legacy names.

  /////////////////////////////////////////////
  // The APTicker (increments Action Points)
  /////////////////////////////////////////////

  // Written as Singleton, like original Ticker

  var APTicker = {
    interval: 0,
    offset: 0,
    start: function (offset) {
      if (!this.timeout) {
        this.tick(offset);
      }
    },
    reset: function () {
      window.clearTimeout(this.timeout);
      this.tick();
    },
    tick: function (offset) {
      var interval = this.interval;
      if (offset) {
        interval = interval - offset;
        this.offset = offset;
      } else {
        this.offset = 0;
      }
      if (interval > 0) {
        APTicker.lastTick = Date.now();
        this.timeout = window.setTimeout(function () {
          APTicker.listeners.each(function (node) {
            if (node.APTick) {
              node.APTick();
            }
          });
          APTicker.tick();
        }, interval);
      }
    },
    getRemainingTime: function () {
      return new Date(this.lastTick + this.interval - this.offset - Date.now());
    },
    addListener: function (node) {
      this.listeners.add(node);
    },
    removeListener: function (node) {
      this.listeners.remove(node);
    },
    stop: function () {
      window.clearTimeout(this.timeout);
      this.timeout = undefined;
    },
  };
  APTicker.listeners = new Set();

  /////////////////////////////////////////////
  // The AniTicker (increments Action Points)
  /////////////////////////////////////////////

  // Written as Singleton, like original Ticker

  var AniTicker = {
    interval: 5000,
    counter: 0,
    start: function () {
      AniTicker.counter = 0;
      if (!this.timeout) {
        this.tick();
      }
    },
    reset: function () {
      window.clearTimeout(this.timeout);
      this.tick();
    },
    tick: function () {
      if (this.interval > 0) {
        this.timeout = window.setTimeout(function () {
          var node = AniTicker.listeners.set[0];
          AniTicker.interval = Math.random() * 1500 + 5000;

          if (node) {
            node.AniTick();
          }
          // only shuffle when all items were served (uses counter)
          AniTicker.listeners.set = _.shuffle(AniTicker.listeners.set);
          AniTicker.tick();
        }, this.interval);

        /* // Shuffle all Test
          AniTicker.counter += 1;
          this.timeout = window.setTimeout(function(){
            var node = AniTicker.listeners.set[0];

            var first = AniTicker.listeners.set.shift();
            if (first) {
              AniTicker.listeners.set.push(first);
            }
            if (node) {
              node.AniTick();
            }
            // only shuffle when all items were served (uses counter)
            AniTicker.interval = (Math.random()) * 1000 + 1000;
            if (AniTicker.counter > AniTicker.listeners.length -1) {
              AniTicker.listeners.set = _.shuffle(AniTicker.listeners.set);
              AniTicker.counter = 0;
              AniTicker.interval = 4000 + 1000 * AniTicker.listeners.length;
            }
            AniTicker.tick();
          },this.interval);
          */
      }
    },
    addListener: function (node) {
      if (node.AniTick) {
        this.listeners.add(node);
      }
    },
    removeListener: function (node) {
      this.listeners.remove(node);
    },
    stop: function () {
      window.clearTimeout(this.timeout);
      this.timeout = undefined;
    },
  };
  AniTicker.listeners = new Set();

  //////////////////////////////////////////
  // GameNode base class
  //////////////////////////////////////////
  //
  // Extracted to scripts/game/GameNode.ts (imported above).  Subclasses
  // below extend it via the legacy `extend(SubClass, GameNode)` helper;
  // additional GameNode.prototype.X = ... assignments scattered through
  // this file (openGenericPopup, initPopupEvents, fetchProvided, Error,
  // NoCash, NoAP) attach to the imported class via live-binding mutation
  // — the same way they did inside the IIFE.

  //////////////////////////////////////////////////
  // The Subclasses
  //////////////////////////////////////////////////

  ///////////////////////////////////
  // The GameRoot of all Evil
  // Currently only a single instance of GameRoot should be instantiated
  // On Game.init GameRoot is exposed globally to app as app.game
  // GameRoot (app.game) can be accessed in debug mode from the console
  // TODO: better way to publish only those parts of the api that need to be global
  ///////////////////////////////////

  GameRoot.prototype.refresh = function () {
    // Reload the game data and reinit the whole Game (like a page reload).
    var groot = this;
    groot.retryDelay = groot.retryDelay || 2000;

    groot.lock();

    return app.remote
      .getSessionLocale()
      .then(function (data) {
        var locale = data.result === 'de' ? 'de_AT' : 'en_US';
        i18n.setLocale(locale);
        var html = app.renderView('game.html');
        $('#dd-control').html(html);
        return app.remote.loadGame().then(function (data) {
          var Game = getGame();
          var gameData = data.result;
          app.version = gameData.version;
          Game.init(gameData);
        });
      })
      .fail(function (data) {
        if (groot.notificationPopup) {
          groot.notificationPopup.trigger('error');
          window.setTimeout(function () {
            if (groot.notificationPopup) {
              groot.notificationPopup.render();
            }
          }, groot.retryDelay);
          groot.retryDelay += 1000;
          if (groot.retryDelay > 6000) {
            document.location.href = '/';
          }
        }
      });
  };

  GameRoot.prototype.extendRender = function () {
    if (this.renderMenu) {
      this.renderMenu.remove();
    }
    var menu = new Render.MainMenu({
      gameNode: this,
      data: {
        logo: {
          frameSrc: 'MainSprites.png',
          frameMap: {
            normal: { x: 1, y: 819, width: 222, height: 40 },
          },
          frame: 'normal',
          className: 'MainMenuLogo',
        },
        userdata: this.userdata,
        buttons: [],
      },
    });

    this.initStatusBar();
    var statusbar = (this.renderStatusbar = new Render.Statusbar(this.data.status_bar));

    var stage = this.renderNode;
    stage.gameNode = this;
    if (setup.debug) {
      $(setup.renderContainer).addClass('debugmode');
    }
    $(setup.renderContainer).append(menu.domelem);
    menu.initUI();
    $(setup.renderContainer).append(stage.domelem);
    this.renderNode = stage;
    this.renderMenu = menu;
    stage.addChild(statusbar);
  };

  function _showLangPicker(canDismiss) {
    var $overlay = $(
      '<div class="LangSelectOverlay" style="position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.75);z-index:9999;display:flex;align-items:center;justify-content:center;">' +
        '<div class="LangPickerBox" style="background:#BFE7F5;border:3px solid #009FD9;border-radius:12px;padding:24px 32px;text-align:center;box-shadow:3px 3px 0px #009FD9,3px 3px 8px rgba(0,0,0,0.5);">' +
        '<div style="font-family:Bowlby;color:#009FD9;font-size:20px;margin-bottom:16px;">Choose your language<br>Sprache wählen</div>' +
        '<div style="display:flex;gap:16px;justify-content:center;">' +
        '<div class="Button lang-pick" data-locale="en">🇺🇸🇬🇧🇦🇺 EN</div>' +
        '<div class="Button lang-pick" data-locale="de">🇩🇪🇦🇹🇨🇭 DE</div>' +
        '</div>' +
        '</div>' +
        '</div>'
    );
    $('body').append($overlay);
    var picked = false;
    $overlay.on('click touchend', '.lang-pick', function (e) {
      e.stopPropagation();
      e.preventDefault();
      if (picked) {
        return;
      }
      picked = true;
      var chosen = $(this).data('locale');
      $overlay.find('.lang-pick').addClass('disabled');
      app.remote.setLocale(chosen).done(function () {
        location.reload();
      });
    });
    if (canDismiss) {
      $overlay.on('click touchend', function (e) {
        if (!$(e.target).closest('.LangPickerBox').length) {
          e.preventDefault();
          $overlay.remove();
        }
      });
    }
  }

  GameRoot.prototype.initEventHandlers = function () {
    var gnode = this;

    // FIXME: This event should be renamed as we are out of the test phase – or are we?
    gnode.on('saveCoordsQueue', function (e, path, pos) {
      app.remote.setPerpCoordinates([[path, pos]]);
    });
    gnode.on('saveCoords', function (e, path, pos) {
      app.remote.setPerpCoordinates([[path, pos]]);
    });

    gnode.on('switch_view', function (e, view_id) {
      e.stopPropagation();
      _.each(gnode.renderMenu.data.buttons, function (button) {
        if (view_id !== button.id) {
          getById(button.id).setState('active', false);
        }
      });
      gnode.activeView = getById(view_id);
      gnode.activeView.setState('active', true);
      // Refresh scroller dimensions in case the stage was resized while
      // this tab was inactive. Tab switches preserve scroll position;
      // the reset-zoom button is the explicit way to recentre.
      var vm = gnode.activeView && gnode.activeView.renderNode;
      if (vm && typeof vm.updateScroller === 'function') {
        vm.updateScroller();
      }
    });

    gnode.on('toggle_locale', function (e) {
      e.stopPropagation();
      _showLangPicker(true);
    });

    gnode.on('user_data', function (e) {
      e.stopPropagation();
      gnode.openGenericPopup({
        data: {
          title: 'About',
          description: 'Data Dealer &mdash; webxdc port',
        },
        template: 'popup_user_data.html',
      });
    });

    gnode.on('click_status.karma', function (e) {
      var providedKarma = gnode.compileProvidedKarma();
      gnode.openGenericPopup({
        data: {
          title: _._('karma_popup title'),
          description: _._('karma_popup description'),
          selectortitle: _._('karma_popup selector title'),
          mainsprites_class: 'karma',
          providedKarma: providedKarma,
        },
        template: 'popup_karma.html',
      });
    });

    gnode.on('click_status.Profiles', function (e) {
      gnode.openGenericPopup({
        data: {
          title: _._('sb_profiles title'),
          subtitle: _.sprintf(
            _._('sb_profiles subtitle %s from %s profiles'),
            _.span(_.toKSNum(gnode.profiles_value)),
            _.span(_.toKSNum(gnode.profiles_max))
          ),
          description: _._('sb_profiles description'),
          mainsprites_class: 'Profiles',
        },
        template: 'popup_status.html',
      });
    });

    gnode.on('click_status.Cash', function (e) {
      gnode.openGenericPopup({
        data: {
          title: _._('sb_cash title'),
          subtitle: _.sprintf(
            _._('sb_cash subtitle <span class="highlight">$%s</span>'),
            _.toKSNum(gnode.cash_value)
          ),
          description: _._('sb_cash description'),
          mainsprites_class: 'Cash',
        },
        template: 'popup_status.html',
      });
    });

    gnode.on('click_status.AP', function (e) {
      gnode.openGenericPopup({
        data: {
          title: _._('sb_AP title'),
          subtitle: _.sprintf(
            _._('sb_AP subtitle %s/%s'),
            _.span(_.toKSNum(gnode.ap_value)),
            _.span(_.toKSNum(gnode.xp_level.ap_max))
          ),
          description: _._('sb_AP description'),
          mainsprites_class: 'AP',
        },
        template: 'popup_status.html',
      });
    });

    gnode.on('click_status.XP', function (e) {
      gnode.openGenericPopup({
        data: {
          title: _._('sb_XP title'),
          subtitle: _.sprintf(
            _._('sb_XP subtitle Level %s'),
            _.span(_.toKSNum(gnode.xp_level.number))
          ),
          description: _.sprintf(
            _._('sb_XP description %s XP until next level'),
            _.span(_.toKSNum(gnode.xp_level.xp_max - gnode.xp_value + 1))
          ),
          mainsprites_class: 'XP',
        },
        template: 'popup_status.html',
      });
    });

    gnode.on('new_items', function (e, data) {
      e.stopPropagation();
      gnode.makeNotifications(data);
    });
  };

  GameRoot.prototype.BuyPerp = function (gestalt, placePos) {
    // Wrapper for misc Buy operations
    var gtype = this.getTypeFromGestalt(gestalt);
    if (gtype === 'CityPerp') {
      var DBPerp = getByType('DatabasePerp');
      if (DBPerp.length) {
        DBPerp = DBPerp[0];
      } else {
        return;
      }
      return DBPerp.BuyCity(gestalt, placePos);
    } else if (gtype === 'Karmalauter') {
      //console.log('buy a karma?',gestalt);
      return this.BuyKarma(gestalt);
    } else {
      //console.log('ERROR, computer says: can\'t buy',gestalt,gtype);
      this.Error('The computer says NOOOO', data);
    }
  };

  ///////////////////////////////////////
  // Loading a Game happens here:
  //////////////////////////////////////

  GameRoot.prototype.loadGame = function (data) {
    // Clear if there are instances in the singleton
    clear();
    // Initialize the Game with self (reminder: there should only be one GameRoot!)
    var game = this;
    game.APTicker = APTicker;

    if (setup.debug) {
      app.Game = Game;
    }

    // Register all types (applies to all game_types)
    _.each(data.type_registry, function (v, k) {
      game.addType(k, v);
    });

    // Register dummy gestalt of GameRoot (needed for type_settings):
    game.addType('GameRoot', {
      game_type: 'GameRoot',
      type_data: data.type_data || {},
    });
    game.addType('ProfileSet', {
      game_type: 'ProfileSet',
      type_data: {},
    });

    // Basic config of the GameRoot
    var config = {
      id: data._id,
      userdata: data.user,
      raw_data: data,
      data: mergeData(game.getTypeData('GameRoot'), data),
      gameType: 'GameRoot',
    };
    this.init(config);

    // Seed display_name from webxdc.selfName on first boot; persisted as a delta
    // so the name survives reloads without prompting the user again. The helper
    // is non-mutating — we route the new name through setDisplayName so the
    // reducer produces a fresh state instead of corrupting the live reference.
    var newSelfName = webxdcIdentity.getMessengerDisplayNameChange(this.data.user);
    if (newSelfName) {
      app.remote.setDisplayName(newSelfName);
    }

    this.initGameValues();

    this.makeRenderConfig();

    // Make Main Tabs
    _.each(['Imperium', 'Database'], function (v) {
      game.addType(v, {
        game_type: v,
        type_data: data[v].type_data || {},
      });
      var viewmap = new Game[v]({
        id: data[v].game_id,
        path: data[v].full_path,
        data: mergeData(game.getTypeData(v), data[v].instance_data),
        renderNodeParent: game.id,
        gameType: v,
      });
      game[v] = viewmap;
      game.addChild(viewmap);
    });

    // Make Missions Tab
    game.addType('Missions', {
      game_type: 'Missions',
      type_data: {},
    });
    var viewmap = new Game.Missions({
      id: 'Missions',
      data: game.getTypeData('Missions'),
      renderNodeParent: game.id,
      gameType: 'Missions',
    });
    game.Missions = viewmap;
    game.addChild(viewmap);

    // Make Topscores Tab
    game.addType('Topscores', {
      game_type: 'Topscores',
      type_data: {},
    });
    game.addType('Topscore', {
      game_type: 'Topscore',
      type_data: {},
    });

    topscores = new Game.Topscores({
      id: 'Topscores',
      data: game.getTypeData('Topscores'),
      renderNodeParent: game.id,
      gameType: 'Topscores',
    });
    game.Topscores = topscores;
    game.addChild(topscores);
    _.each(topscores.data.type_titles, function (title, type) {
      topscores.initTopscore(type);
    });

    // Fill DBTokens lookup table
    _.each(_.where(game.raw_data.nodes, { game_type: 'TokenPerp' }), function (t) {
      game.DBTokens[t.gestalt] = t.instance_data.amount;
    });

    game.getDBTokensLength();
    game.getDBTokensLengthMax();

    // Create Imperium and Database GameNode Tree Structure without recursion
    var sortnodes = _.sortBy(data.nodes, function (elem) {
      return elem.full_path;
    });

    // exclude origin tokens
    sortnodes = _.filter(sortnodes, function (n) {
      if (n.gestalt) {
        return n.gestalt.substring(0, 6) !== 'origin';
      } else {
        return true;
      }
    });

    _.each(sortnodes, function (datanode, k) {
      var parentGameNode = getParentFromPath(datanode.full_path);
      // get gestalt from full_type if not available:
      if (!datanode.gestalt) {
        datanode.gestalt = getGestalt(datanode.full_type);
      }
      // register dummy type when node not in typeRegistry:
      if (!game.getType(datanode.gestalt)) {
        game.addType(datanode.gestalt, {
          game_type: datanode.game_type,
          type_data: datanode.type_data,
        });
      }
      var type_data = game.getTypeData(datanode.gestalt);
      var node_data = mergeData(type_data, datanode.instance_data);
      var perp = new Game[datanode.game_type]({
        id: datanode.game_id,
        gestalt: getGestalt(datanode.full_type),
        path: datanode.full_path,
        data: node_data,
        // Render perps to first item in path (Imperium or Database)
        renderNodeParent: getFirstId(datanode.full_path),
        ViewMap: getByFirstId(datanode.full_path),
        parentNode: parentGameNode,
        gameType: datanode.game_type,
      });
      parentGameNode.addChild(perp);
    });

    _.each(data.nodes_charging, function (v) {
      var gnode = getByLastId(v.path);
      var timerconf = {
        serverTime: game.raw_data.server_time.$date,
        duration: gnode.data.charge_time,
        // chargeEntry.charge_start is a plain epoch-ms number — no $date wrapper.
        serverStart: v.charge_start,
      };
      gnode.setAttrs({ _loadTimer: timerconf });
    });

    _.each(data.nodes_collect, function (v) {
      var gnode = getByLastId(v.path);
      gnode.setAttrs({ _loadReady: true });
    });

    // register Missions...
    game.Missions.initMissions(data);

    _.each(data.db_queue, function (v) {
      game.getDatabase().cue(v.profile_set, v.origin, v.collect_id);
    });

    // register Karmalizers and Karmalauters...
    _.each(data.karmalauters, function (p, key) {
      game.addType(p.type_data.gestalt, p);
    });
    _.each(data.karmalizers, function (p, key) {
      game.addType(p.type_data.gestalt, p);
    });

    // compile origin tokens for Database
    game.compileOriginTokens(data.nodes);

    game.on('after_render', function () {
      game.renderNode.show();
      AniTicker.start();
    });
    game.on('before_render', function () {
      game.renderNode.hide();
    });

    game.render();
    // On first game start with no explicit locale choice, ask the player.
    if (data.is_new_game && !data.locale_persisted) {
      _showLangPicker(false);
    }

    // fitToWindow handles centring; the legacy is_new_game scrollTo would
    // be immediately overwritten so we no longer set it here.
    game.fitToWindow();
    $(window)
      .off('resize.gameFit')
      .on(
        'resize.gameFit',
        _.debounce(function () {
          game.fitToWindow();
        }, 100)
      );
    // The mobile MainMenu grows after the XP bar gets cloned in and on
    // CSS-driven reflows (orientation, font load); refit the Stage
    // whenever the header's measured height changes so we don't push
    // the playfield past the bottom of the viewport.
    if (game.renderMenu && game.renderMenu.domelem && typeof ResizeObserver === 'function') {
      var refit = _.debounce(function () {
        game.fitToWindow();
      }, 50);
      new ResizeObserver(refit).observe(game.renderMenu.domelem);
    }

    return game;
  };

  GameRoot.prototype.getImperium = function () {
    // FIXME: this is just a wrapper
    return this.Imperium;
  };

  GameRoot.prototype.getDatabase = function () {
    // FIXME: this is just a wrapper
    return this.Database;
  };

  ///////////////////////////////////
  // The ProfileSet
  ///////////////////////////////////
  //
  // Extracted to scripts/game/ProfileSet.ts in PR 9 of issue #147.  The
  // class is imported above; the API publisher at the bottom of this
  // IIFE re-exposes it as Game.ProfileSet (where applicable) and
  // Database.cue / Perp BuyToken flows reach it through the imported
  // identity.

  ///////////////////////////////////
  // The Imperium
  ///////////////////////////////////
  //
  // Extracted to scripts/game/Imperium.ts in PR 8 of issue #147.  The
  // class is imported above; the API publisher at the bottom of this
  // IIFE re-exposes it as Game.Imperium so call sites (GameRoot.loadGame
  // etc.) keep working unchanged.

  ///////////////////////////////////
  // The Database
  ///////////////////////////////////
  //
  // Extracted to scripts/game/Database.ts in PR 10 of issue #147.  The
  // class is imported above; the API publisher at the bottom of this
  // IIFE re-exposes it as Game.Database.  Database resolves the
  // `Game[node.game_type]` lookup via `perpCtors[name]` (typed direct
  // map) and the known-name `Game.TokenPerp` reference via a direct
  // import — both wired up in PR 17 of issue #147.

  ///////////////////////////////////
  // The GamePerp Base Class
  ///////////////////////////////////
  //
  // Extracted to scripts/game/GamePerp.ts in PR 11 of issue #147.  The
  // class is imported above; the API publisher at the bottom of this
  // IIFE re-exposes it as Game.GamePerp.  The dynamic
  // `Game[node.game_type]` lookup in BuyPerp is routed through
  // scripts/game/perpRegistry.ts (seeded as a side effect of
  // perpCtors.ts; the import on line 49 of this file kicks the
  // registration before any BuyPerp flow runs).  AniTicker is injected
  // via setAniTicker(AniTicker) at the IIFE's tail so GamePerp can
  // subscribe to charge-running animations.

  ///////////////////////////////////
  // The Top Scores
  ///////////////////////////////////
  //
  // Extracted to scripts/game/Topscore.ts and scripts/game/Topscores.ts
  // in PR 6 of issue #147.  Both classes are imported above; the API
  // publisher at the bottom of this IIFE re-exposes them as
  // Game.Topscores / Game.Topscore so callers (GameRoot.loadGame etc.)
  // keep working unchanged.

  ///////////////////////////////////
  // The Missions and Mission Classes
  ///////////////////////////////////
  //
  // Extracted to scripts/game/Mission.ts and scripts/game/Missions.ts
  // in PR 7 of issue #147.  Both classes are imported above; the API
  // publisher at the bottom of this IIFE re-exposes them as
  // Game.Missions / Game.Mission so call sites (GameRoot.loadGame,
  // Mission.openMissionPopup → groot.openGenericPopup, etc.) keep
  // working unchanged.
  //
  // DatabasePerp + CityPerp similarly extracted to scripts/game/
  // DatabasePerp.ts / CityPerp.ts in PR 12 of issue #147.

  ////////////////////////////////////////////
  // The API Publisher
  ////////////////////////////////////////////

  var Game = {
    get: get,
    getById: getById,
    getByType: getByType,
    getByGestalt: getByGestalt,
    getAllByGestalt: getAllByGestalt,
    eachByGestalt: eachByGestalt,
    APTicker: APTicker,
    init: init,
    _instances: _instances,
    _ids: _ids,
    GameNode: GameNode,
    GameRoot: GameRoot,
    Mission: Mission,
    Missions: Missions,
    Topscores: Topscores,
    Topscore: Topscore,
    Imperium: Imperium,
    Database: Database,
    DatabasePerp: DatabasePerp,
    CityPerp: CityPerp,
    AgentPerp: AgentPerp,
    ContactPerp: ContactPerp,
    PusherPerp: PusherPerp,
    ClientPerp: ClientPerp,
    TokenPerp: TokenPerp,
    ProxyPerp: ProxyPerp,
    ProjectPerp: ProjectPerp,
    SupertokenPerp: SupertokenPerp,
  };

  // Inject AniTicker into GamePerp / GameRoot so their lock/unlock and
  // initEventHandlers can register listeners on the legacy ticker
  // singleton (which still lives in this IIFE). Disposable seam;
  // retires when AniTicker is itself extracted from Game.js.
  setAniTicker(AniTicker);
  setAniTickerForGameRoot(AniTicker);
  // APTicker (level-derived AP regen interval) is consumed by
  // GameRoot.setLevel and GameRoot.APTick; injected the same way as
  // AniTicker until APTicker itself is extracted from this IIFE.
  setAPTickerForGameRoot(APTicker);

  return Game;
};

var game;

export function getGame() {
  game = game || Game();
  return game;
}

export default { getGame };
