// @ts-nocheck — strict-TS quarantine; remove when this file is migrated to TS (issue #147)
import { getRender } from './Render.js';
// Vendor libs ($, _, sprintf) are read off globalThis at factory-body
// time, not at module-evaluation time, so this module can be bundled
// alongside scripts that run before vendor `<script>` tags execute.
import appModule from './app.js';
import * as bootMod from './boot.js';
import { CityPerp } from './game/CityPerp.js';
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
import { Imperium } from './game/Imperium.js';
import { Mission } from './game/Mission.js';
import { Missions } from './game/Missions.js';
import { OrderedSet } from './game/OrderedSet.js';
import { ProfileSet } from './game/ProfileSet.js';
import { Topscore } from './game/Topscore.js';
import { Topscores } from './game/Topscores.js';
import { mergeData } from './game/mergeData.js';
import { setPerpClasses } from './game/perpRegistry.js';
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

  // mergeData was extracted to scripts/game/mergeData.ts (imported above).

  var convertPowerupType = function (game_type) {
    // This costs a beer dudes...
    var convertCat = {
      UpgradePowerup: 'upgrade',
      AdPowerup: 'ad',
      TeamMemberPowerup: 'teammember',
    };
    return convertCat[game_type];
  };

  var getPowerupTypeFromGestalt = function (gestalt) {
    var convertCat = {
      upgrade: 'UpgradePowerup',
      ad: 'AdPowerup',
      teammember: 'TeamMemberPowerup',
    };
    var cat = undefined;
    _.each(convertCat, function (v, k) {
      if (gestalt.substring(0, k.length) === k) {
        cat = v;
      }
    });
    return cat;
  };

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

  var GameRoot = function (config) {
    // Initialize the typeRegistry
    this.typeRegistry = {};
    this.DBTokensLength = 0;
    this.DBTokensLengthMax = 0;
    this.DBTokens = {};
    this.DBOriginTokens = {};
    this.DBTokensAbsolute = {};
    this.DBTokensCrossSum = 0;
    this.IPerps = {};
    this.NotificationQueue = [];
    return this;
  };
  extend(GameRoot, GameNode);

  GameRoot.prototype.renderType = 'Stage';

  GameRoot.prototype.get = get;

  GameRoot.prototype.setup = setup;

  GameRoot.prototype.ids = _ids;
  GameRoot.prototype.getById = getById;

  GameRoot.prototype.addType = function (gestalt, data) {
    // Add a type to the typeRegistry data should have data.type_data
    // If the game_type is also defined in typeSettings it will be merged and overwritten with data
    if (data.game_type && data.type_data) {
      if (typeSettings.hasOwnProperty(data.game_type)) {
        data.type_data = mergeData(typeSettings[data.game_type].type_data, data.type_data);
      }
    }
    this.typeRegistry[gestalt] = data;
    this.typeRegistry[gestalt].gestalt = gestalt;
    this.typeRegistry[gestalt].game_type = data.game_type;
    // FIXME: is_supertoken fix for export fail.
    if (gestalt.substring(0, 5) === 'token') {
      this.typeRegistry[gestalt].type_data.is_supertoken = false;
    }

    return this.typeRegistry[gestalt];
  };

  GameRoot.prototype.addSubType = function (parent_gestalt, gestalt, data) {
    // Add a subtype to the typeRegistry data should have data.type_data
    // If the game_type is also defined in typeSettings it will be merged and overwritten with data
    var groot = this;
    var parentType = groot.getType(parent_gestalt);
    if (parentType) {
      if (data.game_type && data.type_data) {
        if (typeSettings.hasOwnProperty(data.game_type)) {
          data.type_data = mergeData(typeSettings[data.game_type].type_data, data.type_data);
          // expand powerup tokens with their type data
          if (data.type_data.tokens && data.type_data.tokens.length) {
            _.each(data.type_data.tokens, function (v, k) {
              v.type_data = groot.getTypeData(v.gestalt);
            });
          }
        }
        return (parentType[gestalt] = data);
      }
    }
  };

  GameRoot.prototype.removeType = function (gestalt) {
    // Remove a type from the typeRegistry
    delete this.typeRegistry[gestalt];
  };
  GameRoot.prototype.getType = function (gestalt) {
    // Get type from the registry, Note on the structure: data.type_data
    return this.typeRegistry[gestalt];
  };
  GameRoot.prototype.getTypeData = function (gestalt) {
    // Get type_data from the registry, Note on the structure: data.type_data
    var type = this.getType(gestalt);
    if (type) {
      return type.type_data;
    } else {
      return undefined;
    }
  };
  GameRoot.prototype.getTypes = function (game_type) {
    // Get all types with game_type from the registry
    //return this.typeRegistry[gestalt];
    return _.where(this.typeRegistry, { game_type: game_type });
  };
  GameRoot.prototype.getTypeFromGestalt = function (gestalt) {
    // Get all types with game_type from the registry
    if (gestalt) {
      return this.typeRegistry[gestalt].game_type;
    } else {
      return {};
    }
  };

  GameRoot.prototype.getDBTokenAmount = function (gestalt) {
    if (this.DBTokens && this.DBTokens.hasOwnProperty(gestalt)) {
      return this.DBTokens[gestalt];
    } else {
      return 0;
    }
  };

  GameRoot.prototype.getDBTokensLength = function () {
    // without origin tokens
    return (this.DBTokensLength = _.filter(_.keys(this.DBTokens), function (t) {
      return t.substring(0, 6) !== 'origin';
    }).length);
  };

  GameRoot.prototype.getDBTokensLengthMax = function () {
    // without origin tokens
    return (this.DBTokensLengthMax = _.filter(
      _.where(this.typeRegistry, { game_type: 'TokenPerp' }),
      function (t) {
        return t.gestalt.substring(0, 6) !== 'origin';
      }
    ).length);
  };

  GameRoot.prototype.getDBTokensCrossSum = function (gestalt) {
    var DBTokens = this.DBTokens;
    var sum = 0;
    var count = 1;
    _.each(DBTokens, function (t, k) {
      sum += t;
      count += 1;
    });
    return sum / count;
  };

  GameRoot.prototype.compileOriginTokens = function (nodes) {
    var groot = this;
    var origintokens = _.filter(nodes, function (n) {
      if (n.gestalt) {
        return n.gestalt.substring(0, 6) === 'origin';
      } else {
        return false;
      }
    });
    _.each(origintokens, function (t, k) {
      var ot = (groot.DBOriginTokens[t.gestalt] = {});
      ot.gestalt = t.gestalt;
      ot.data = groot.getTypeData(t.gestalt);
      ot.amount = ot.data.amount = t.instance_data.amount;
      ot.absoluteAmount = (groot.profiles_value * ot.amount) / 100;
      ot.originGameNode = getByGestalt(ot.data.origin_gestalt);
      ot.originGameType = ot.originGameNode.gameType;
      if (ot.originGameType === 'CityPerp') {
        var citymax = ot.originGameNode.data.profiles_max;
        ot.cityMaxAmount = ((ot.amount / 100) * groot.profiles_value) / citymax;
        //((float(amounts.get(origin_gestalt, 0))/100) * self.game_values.get('profiles_value')) / origin_data.get('type_data').get('profiles_max')
      }
    });
  };

  GameRoot.prototype.getOriginGestaltFromOriginTokenGestalt = function (origintokengestalt) {
    var origin =
      _.find(this.DBOriginTokens, function (ot) {
        return ot.originGameNode.gestalt === 'city002';
      }) || {};
    return origin.gestalt;
  };

  GameRoot.prototype.kill = function () {
    console.warn('Killing Game');
    clear();
    delete app.game;
  };

  GameRoot.prototype.lock = function () {
    // Lock the whole stage and turn off triggering of render Events
    // TODO make stage spinner in Render and use proper method to unbind events
    // Unlock currently wouldn't work since all events are destroyed
    if (this.renderNode) {
      this.renderNode.lock();
      this.renderMenu.lock();
      AniTicker.stop();
    }
    // FIXME for Popups
    //this.renderNode.jdomelem.find('*').off();
  };
  GameRoot.prototype.unlock = function () {
    if (this.NotificationQueue && this.NotificationQueue.length < 2) {
      this.renderNode.unlock();
      this.renderMenu.unlock();
      AniTicker.start();
    } else if (!this.NotificationQueue) {
      this.renderNode.unlock();
      this.renderMenu.unlock();
      AniTicker.start();
    }
    //this.renderNode.jdomelem.find('*').off();
  };

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

  GameRoot.prototype.getParentTypes = function (gestalt) {
    // returns the type_data of all perps where gestalt is provided
    var types = _.filter(this.typeRegistry, function (t) {
      return _.contains(t.type_data.provided_perps, gestalt);
    });
    if (types) {
      return types;
    } else {
      return {};
    }
  };

  GameRoot.prototype.getParentTypeData = function (gestalt) {
    // returns the type_data of a perp where gestalt is provided
    var type = _.find(this.typeRegistry, function (t) {
      return _.contains(t.type_data.provided_perps, gestalt);
    });
    if (type) {
      return type.type_data;
    } else {
      return {};
    }
  };

  GameRoot.prototype.getParentType = function (gestalt) {
    // returns the type_data of a perp where gestalt is provided
    var type = _.find(this.typeRegistry, function (t) {
      return _.contains(t.type_data.provided_perps, gestalt);
    });
    if (type) {
      return type;
    } else {
      return {};
    }
  };

  GameRoot.prototype.notification_level = 2;
  GameRoot.prototype.makeNotifications = function (data) {
    var gnode = this;
    var groot = this;
    var speed = 1;
    if (setup.debug) {
      speed = 0;
    }
    if (data.mission_complete) {
      var mission = groot.Missions.getMission(data.mission_complete);
      var n = mergeData({}, mission.data);
      n.game_type = 'MissionComplete';
      n.mission_decorator = _._('Mission complete!');
      n.states = mission.states;
      n.config = {
        template: 'popup_mission_complete.html',
        extendClass: 'Mission',
        delay: 2500,
        delayScript: 1000,
      };
      n.scriptedEvents = [];
      n.scriptedEvents.push(function () {
        groot.renderNode.FXMissionComplete();
      });
      gnode.cueNotification(n);
    }
    if (data.mission_active) {
      // Only show the briefing if the player hasn't already dismissed it.
      // The seen-flag is persisted via the dismissMissionBriefing op so it
      // survives webxdc replay across reloads.
      var seenBriefings = (groot.raw_data && groot.raw_data.mission_briefings_seen) || {};
      if (!seenBriefings[data.mission_active]) {
        var mission = groot.Missions.getMission(data.mission_active);
        n = mergeData({}, mission.data);
        n.game_type = 'MissionNew';
        n.states = mission.states;
        n.mission_decorator = _._('New Mission!');
        n.mission = mission;
        n.mission_active_gestalt = data.mission_active;
        n.config = {
          template: 'popup_mission.html',
          extendClass: 'Mission',
        };
        gnode.cueNotification(n);
      }
    }
    if (data.levelup) {
      var n = {};
      n.game_type = 'LevelUp';
      n.config = {
        template: 'levelup.html',
        extendClass: 'Tutorial',
        placeBottom: true,
        delay: 1200,
      };
      //n.nonblocking = 2000;
      n.scriptedEvents = [];
      n.scriptedEvents.push(function () {
        groot.renderNode.FXLevelUpBling(data.levelup);
      });
      gnode.cueNotification(n);
    }
    // FIXME: this turns off notifications during tutorials in general, currently only set by level
    //if (data.perps && groot.states.tutorial_active !== true && groot.xp_level.number > 2) {
    if (data.perps && groot.xp_level.number > groot.notification_level) {
      _.each(data.perps, function (gestalt) {
        var n = {};
        n.config = n.config || {};
        n.config.extendClass = 'NewItems';
        var type = gnode.getType(gestalt);
        n.game_type = type.game_type;
        var tdata = gnode.getTypeData(gestalt);
        if (type && tdata && !getByGestalt(gestalt)) {
          var parentIsBuilt = false;
          var parentTypes = gnode.getParentTypes(gestalt);
          _.each(parentTypes, function (parentType) {
            var parentTypeData = parentType.type_data;
            parentsBuilt = getAllByGestalt(parentType.gestalt).length;
            parentIsBuilt = parentIsBuilt ? parentIsBuilt : parentsBuilt > 0;
            n.perp = { data: tdata };
            n.title = tdata.ntitle;
            n.says = _._('Mark says:');
            if (parentTypeData && parentTypeData.title) {
              n.text = _.sprintf(tdata.ntext, _.span(parentTypeData.title));
              eachByGestalt(parentType.gestalt, function (v, k) {
                if (v.renderNode) {
                  v.markNewItems();
                  v.checkProvidedByLevel();
                  v.checkProvidedByRequiredPerps();
                  v.highlightTabs = v.highlightTabs || [];
                  v.highlightTabs.push(n.game_type);
                }
              });
            } else {
              n.text = _.sprintf(tdata.ntext, _.span(tdata.title));
            }
          });
          if (parentIsBuilt) {
            gnode.cueNotification(n);
          }
        }
      });
    }
    // Powerup Notifications
    // FIXME same as by perps
    //if (data.powerups && groot.states.tutorial_active !== true) {
    if (data.powerups && groot.xp_level.number > groot.notification_level) {
      // remap the response and prepare the types 'n' data.
      var pow_register = {};
      _.each(data.powerups, function (project_pows, projectgestalt) {
        var project = getByGestalt(projectgestalt);
        if (project) {
          _.each(project_pows, function (powerup) {
            var powgestalt = powerup.game_gestalt;
            if (!project.getType(powgestalt)) {
              project.addType(powgestalt, powerup);
            }
            var powerup_type = project.getType(powgestalt);
            if (!pow_register.hasOwnProperty(powerup.game_gestalt)) {
              pow_register[powerup.game_gestalt] = {};
            }
            var pow_reg = pow_register[powerup.game_gestalt];
            pow_reg.game_type = powerup_type.game_type;
            pow_reg.type_data = powerup_type.type_data;
            pow_reg.projects = pow_reg.projects || [];
            pow_reg.projects.push(project);
            pow_reg.projects = _.uniq(pow_reg.projects, true);
          });
        }
      });

      _.each(pow_register, function (pow_reg, powgestalt) {
        var n = {};
        n.config = {
          extendClass: 'NewItems',
        };
        n.game_type = pow_reg.game_type;
        n.perp = { data: pow_reg.type_data };
        n.title = pow_reg.type_data.ntitle;
        var projectstext = '';
        // add those decorators and make the projects notification text
        _.each(pow_reg.projects, function (project, k) {
          project.markNewItems();
          project.highlightTabs = project.highlightTabs || [];
          project.highlightTabs.push(n.game_type);
          var sep = k < pow_reg.projects.length - 1 ? ', ' : '';
          projectstext = projectstext + project.data.title + sep;
        });
        n.says = _._('Mark says:');
        n.text = _.sprintf(pow_reg.type_data.ntext, _.span(projectstext));
        // popup only if notification = true;
        if (pow_reg.type_data.notification) {
          gnode.cueNotification(n);
        }
      });
    }
    // Karmalizer Notification
    if (data.karma) {
      groot.compileProvidedKarma();
      var gestalt = data.karma.gestalt;
      var n = groot.getTypeData(gestalt);
      n.selectortitle = _._('Choose your counter measures');
      n.karma_dec = data.karma.dec;
      n.button = _._('Do nothing');
      n.config = {
        template: 'popup_karma.html',
        extendClass: 'Alert',
        delay: 650,
      };
      n.providedKarma = groot.data.providedKarma;
      var type = gnode.getType(gestalt);
      n.game_type = type.game_type;
      gnode.cueNotification(n);
    }

    // Simplemessage
    if (data.simplemessage) {
      var n = {};
      n.game_type = 'Story';
      n.button = _._('Next');
      n.description = data.simplemessage.text;
      n.says = _._('Mark says:');
      n.config = {
        template: 'notification_tutorial.html',
        extendClass: 'Tutorial',
        placeBottom: true,
        delay: 0,
      };
      gnode.cueNotification(n);
    }

    // Tutorials and Missions
    if (data.story && data.storyPerp) {
      var n = {};
      n.game_type = 'Story';
      n.button = _._('Next');
      n.description = data.story.text;
      n.says = _._('Mark says:');
      n.scriptedEvents = [];
      n.scriptedEvents.push(function () {
        groot.trigger('switch_view', [data.storyPerp.ViewMap.id]);
        groot.activeView.renderNode.scrollTo(data.storyPerp.renderNode.getPosition(), 1000);
      });
      n.config = {
        template: 'notification_tutorial.html',
        extendClass: 'Tutorial',
        placeBottom: true,
        delay: 0,
      };
      gnode.cueNotification(n);
    }
    if (data.tutorial) {
      _.each(data.tutorial, function (tutorial) {
        var n = tutorial;
        n.button = _._('Next');
        n.says = _._('Mark says:');
        n.config = {
          template: 'notification_tutorial.html',
          extendClass: 'Tutorial',
          placeBottom: true,
          delay: 600 * speed,
          delayScript: 0,
        };
        n.game_type = 'Tutorial';
        // TODO: handle/compile scripted events
        // n.buyPerp
        // n.buyParent
        // n.buyPerpPos
        // n.viewmap
        // n.viewmapPos
        // n.integrateProfileSet
        var doadd = true;
        // TODO: make sequence and add delays to actions.
        // TODO: do not queue notifications with scripts already done.
        n.scriptedEvents = [];
        if (n.viewmap) {
          n.config.delay = 0;
          // FIXME: Hack for CMS fail
          n.scriptedEvents.push(function () {
            if (n.viewmap === 'empire001') {
              n.viewmap = 'Imperium';
            }
            if (n.viewmap === 'database001') {
              n.viewmap = 'Database';
            }
            groot.trigger('switch_view', [n.viewmap]);
          });
        }
        if (n.viewmapPos) {
          n.config.delay = n.nodelay ? 500 : 1000;
          n.config.delay *= speed;
          n.scriptedEvents.push(function () {
            groot.activeView.renderNode.scrollTo({ x: n.viewmapPos.x, y: n.viewmapPos.y }, 1000);
          });
        }
        if (n.buyPerp && n.buyParent) {
          var buyPerp = getByGestalt(n.buyPerp);
          if (!buyPerp) {
            n.config.delay = n.nodelay ? 500 : 3000;
            n.config.delay *= speed;
          } else {
            n.config.delay = 650;
            n.config.delay *= speed;
          }
          n.scriptedEvents.push(function () {
            var parentNode = getByGestalt(n.buyParent);
            if (parentNode) {
              if (parentNode.renderNode.DecoratorNew) {
                parentNode.renderNode.DecoratorNew.remove();
              }
              var buyPerp = getByGestalt(n.buyPerp);
              if (!buyPerp) {
                buyPerp = parentNode.BuyPerp(n.buyPerp, n.buyPerpPos);
              } else {
                groot.activeView.renderNode.scrollTo({
                  x: buyPerp.renderNode.getPosition().x,
                  y: buyPerp.renderNode.getPosition().y - 40,
                });
              }
            }
          });
        }
        if (n.integrateProfileSet) {
          n.config.delay = n.nodelay ? 500 : 5000;
          n.config.delay *= speed;
          n.scriptedEvents.push(function () {
            var ps = _.find(groot.getDatabase().queue.set, function (ps) {
              return ps.origin.gestalt === 'city002';
            });
            if (ps) {
              groot.getDatabase().mergeCued(ps.psid);
            }
          });
        }
        gnode.cueNotification(n);
      });
    }

    // sort em by type!
    var sort_types = [
      'Error',
      'Story',
      'MissionComplete',
      'LevelUp',
      'Tutorial',
      'Karmalizer',
      'CityPerp',
      'ProxyPerp',
      'ProjectPerp',
      'AgentPerp',
      'ContactPerp',
      'PusherPerp',
      'ClientPerp',
      'TokenPerp',
      'UpgradePowerup',
      'AdPowerup',
      'TeamMemberPowerup',
      'MissionNew',
    ];
    gnode.NotificationQueue = _.sortBy(gnode.NotificationQueue, function (ni) {
      return sort_types.indexOf(ni.game_type);
    });
    if (gnode.NotificationQueue.length) {
      gnode.openNotification(gnode.NotificationQueue[0]);
    }
  };

  GameRoot.prototype.cueNotification = function (notification) {
    this.NotificationQueue.push(notification);
  };

  GameRoot.prototype.startNotificationQueue = function () {};

  GameRoot.prototype.uncueNotification = function (notification) {
    var index = this.NotificationQueue.indexOf(notification);
    if (index !== -1) {
      this.NotificationQueue.splice(index, 1);
    }
  };

  GameRoot.prototype.compileProvidedKarma = function () {
    var gnode = this;
    var groot = this;
    gnode.data.providedKarma = [];

    _.each(groot.getTypes('Karmalauter'), function (v, k) {
      var karma = {};
      karma.data = v.type_data;
      karma.data.slot_background = gnode.data.slot_background;
      karma.gestalt = v.gestalt;
      // FIXME: lock level
      if (karma.data.required_level > groot.xp_level.number) {
        karma.locked = true;
      }
      gnode.data.providedKarma.push(karma);
    });
    gnode.data.providedKarma = _.sortBy(gnode.data.providedKarma, function (k) {
      return k.data.price;
    });
    return gnode.data.providedKarma;
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

  GameRoot.prototype.BuyKarma = function (bgestalt) {
    var gnode = this;
    var groot = this;

    app.remote.buyKarma(bgestalt).done(function (data) {
      if (data.result) {
        if (data.result.error !== undefined) {
          // Probably no cash
          if (gnode.renderPopup && gnode.renderPopup.open) {
            gnode.renderPopup.trigger('no_cash');
          } else {
            gnode.renderNode.FXNoCash();
          }
          return;
        }
        var karma_points = groot.getTypeData(bgestalt).karma_points;
        var karma_value = groot.karma_value;
        var karma_up = karma_points + karma_value <= 100 ? karma_points : 100 - karma_value;
        if (gnode.renderPopup) {
          gnode.renderPopup.trigger('popup_close');
          groot.renderNode.FXKarmaBling(karma_up);
        }
        if (gnode.notificationPopup) {
          gnode.notificationPopup.trigger('popup_close');
          groot.renderNode.FXKarmaBling(karma_up);
        }
        //TODO: Karma Up Animation?
        groot.updateGameValues(data.result.game_values, data.result.levelup, data.result.missions);
      } else if (data.result && data.result.error) {
        if (popup) {
          popup.trigger('error');
        }
      } else {
        // Server Error
        gnode.Error('The computer says NOOOO', data);
      }
    });
  };

  GameNode.prototype.openGenericPopup = function (config) {
    var gnode = config.gnode || this;
    var groot = this.GameRoot;
    var config = config || {};
    var data = config.data || gnode.data;

    gnode.popupTemplateData = {};
    gnode.popupTemplateData.status_icons = gnode.GameRoot.data.status_icons;
    gnode.popupTemplateData.states = config.states || {};
    gnode.popupTemplateData.data = data;
    //gnode.popupTemplateData.data.gestalt = 'Database';
    //gnode.popupTemplateData.data.id = this.id;
    gnode.popupTemplateData.groot = groot;
    gnode.popupTemplateData.data = data;

    var popupConfig = {
      gameNode: this,
      template: config.template || 'popup.html',
      extendClass: config.extendClass || '',
      templateData: gnode.popupTemplateData,
      popupContainer: this,
    };

    var popup = (this.renderPopup = new Render.Popup(popupConfig));

    gnode.renderNode.addPopup(popup);

    gnode.initPopupEvents();

    /*
      popup.on('button_click.MainButton',function(e) {
        e.stopPropagation();
        popup.close();
      });

      popup.on('popup_close',function(e) {
        e.stopPropagation();
        popup.close();
        delete gnode.renderPopup;
      });
      */

    return popup;
  };

  GameRoot.prototype.openNotification = function (notification) {
    var gnode = this;
    var groot = this;
    var config = notification.config || {};
    if (groot.notificationPopup) {
      return;
    }
    var popupTemplateData = {};
    popupTemplateData.status_icons = gnode.GameRoot.data.status_icons;
    popupTemplateData.states = notification.states || {};
    popupTemplateData.data = notification || {};
    popupTemplateData.data.id = this.id;
    popupTemplateData.groot = groot;

    config.template = config.template || 'notification.html';
    config.templateData = popupTemplateData;
    config.popupContainer = this;

    var popup = (gnode.notificationPopup = new Render.Popup(config));
    // Tag the popup with the mission gestalt so the popup_close handler in
    // initPopupEvents can persist the dismissal directly. Persisting in
    // popup.callback (which only fires via popup.close(cb)) was unreliable
    // — popup_close fires the moment the user clicks X, before the close
    // animation/timeout chain that triggers the callback.
    popup.notificationMission = notification.mission_active_gestalt;
    //gnode.lock();

    window.setTimeout(function () {
      if (notification.scriptedEvents && notification.scriptedEvents.length) {
        _.each(notification.scriptedEvents, function (s) {
          s();
        });
      }
    }, config.delayScript || 0);

    window.setTimeout(function () {
      gnode.renderNode.addPopup(popup);
      gnode.initPopupEvents(popup);
    }, config.delay || 0);

    popup.callback = function () {
      groot.uncueNotification(notification);
      delete groot.notificationPopup;
      if (groot.NotificationQueue.length) {
        gnode.openNotification(groot.NotificationQueue[0]);
      }
    };

    if (notification.nonblocking) {
      window.setTimeout(function () {
        popup.trigger('popup_close');
      }, notification.nonblocking);
    }
    return popup;
  };

  // Cancel any debounced _centerActiveView so an explicit camera move
  // (reset-zoom, tutorial scrollTo) isn't clobbered ~50ms later.
  GameRoot.prototype._cancelPendingCenter = function () {
    clearTimeout(this._centerActiveViewTimer);
    this._centerActiveViewTimer = null;
  };

  // The fullscreen button resets zoom AND re-centers on the ViewMap's
  // design home point — for Imperium that's where the seed places the
  // Database (≈1024,800). No-op if no ViewMap is active.
  GameRoot.prototype.resetZoom = function () {
    var view = this.activeView || (this.getImperium && this.getImperium());
    var vm = view && view.renderNode;
    if (!vm || !vm.scroller || typeof vm.scroller.scrollTo !== 'function') return;
    if (typeof vm.updateScroller === 'function') vm.updateScroller();
    var vp = vm.parentNode;
    if (!vp) return;
    this._cancelPendingCenter();
    // Combined zoom+scroll in one __publish so the tween goes
    // (current zoom, current scroll) → (1.0, centered) instead of
    // two animations fighting each other.
    var sx = Math.max(0, vm.width / 2 - vp.width / 2);
    var sy = Math.max(0, vm.height / 2 - vp.height / 2);
    vm.scroller.scrollTo(sx, sy, true, 1);
  };

  // Re-centers the active ViewMap on its design home point. Debounced
  // so rapid callers during initial mount (fitToWindow → after_render
  // → tutorial switch_view) collapse into one scroll.
  GameRoot.prototype._centerActiveView = function (animate) {
    var self = this;
    self._cancelPendingCenter();
    self._centerActiveViewTimer = setTimeout(function () {
      self._centerActiveViewTimer = null;
      var view = self.activeView || (self.getImperium && self.getImperium());
      var vm = view && view.renderNode;
      if (!vm || !vm.scroller || !vm.parentNode) return;
      var vw = vm.parentNode.width;
      var vh = vm.parentNode.height;
      var maxX = Math.max(0, vm.width - vw);
      var maxY = Math.max(0, vm.height - vh);
      var sx = Math.max(0, Math.min(maxX, vm.width / 2 - vw / 2));
      var sy = Math.max(0, Math.min(maxY, vm.height / 2 - vh / 2));
      vm.scroller.scrollTo(sx, sy, animate);
    }, 50);
  };

  // Size the renderable area to the current viewport.  Called on initial
  // load and on window resize so the game fills the available space by
  // default rather than sitting in a 960×600 letterbox.
  GameRoot.prototype.fitToWindow = function () {
    // The MainMenu is a sibling of the Stage in #GameContainer (not a
    // child), so its height eats into the available viewport — without
    // subtracting it the Stage pushes the page past the bottom edge.
    var menuH =
      this.renderMenu && this.renderMenu.jdomelem ? this.renderMenu.jdomelem.outerHeight() : 0;
    this.setSize($(window).width(), $(window).height() - menuH);
    // Refresh the scroller's viewport dimensions so the new stage size is
    // reflected in clamping/zoom math. Without this, scrollTo and the
    // +/- zoom buttons clamp against the previous viewport.
    var view = this.activeView || (this.getImperium && this.getImperium());
    var vm = view && view.renderNode;
    if (vm && typeof vm.updateScroller === 'function') {
      vm.updateScroller();
    }
    this._centerActiveView(false);
  };

  GameRoot.prototype.setSize = function (width, height) {
    width = width || this.renderNode.width;
    height = height || this.renderNode.height;
    var maxwidth = this.getImperium().renderNode.width;
    var maxheight = this.getImperium().renderNode.height;
    width = width > maxwidth ? maxwidth : width;
    width = width < this.data.width ? this.data.width : width;
    height = height > maxheight ? maxheight : height;
    height = height < this.data.height ? this.data.height : height;
    this.renderNode.setSize({
      width: width,
      height: height,
    });
    this.renderMenu.setSize({
      width: width,
    });
    this.renderStatusbar.render();
    this.getDatabase().renderDBQueue.render();
  };

  GameRoot.prototype.initStatusBar = function () {
    this.data.status_bar.gameNode = this;
    this.updateStatusBarValues();
  };

  GameRoot.prototype.setLevel = function (levelnum, nolevelup) {
    var lvl;
    if (levelnum) {
      lvl = this.getLevel(levelnum);
    } else {
      lvl = this.getLevel();
    }
    if (lvl !== this.getLevelByXP(this.xp_value)) {
      this.xp_value = lvl.xp_min;
    }
    this.xp_level = lvl;
    APTicker.interval = lvl.ap_inc_interval;
    if (!nolevelup) {
      APTicker.reset();
    }
    this.setAP();
    this.setXP();
    return this.xp_level;
  };

  GameRoot.prototype.getLevel = function (level) {
    if (level) {
      return this.data.levels[level - 1];
    } else {
      return this.data.levels[this.data.game_values.xp_level - 1];
    }
  };
  GameRoot.prototype.getLevelByXP = function (xp) {
    if (!xp) {
      return {};
    }
    var level = _.find(this.data.levels, function (lvl) {
      return xp >= lvl.xp_min && xp <= lvl.xp_max;
    });
    return level;
  };

  GameRoot.prototype.APTick = function () {
    if (this.xp_level.ap_max > this.ap_value) {
      this.ap_value += this.xp_level.ap_inc_value;
      this.setAP();
      // Remove No-AP decorators
      this.renderNode.jdomelem.find('.Popup .no_AP').removeClass('no_AP disabled active');
    }
  };

  GameRoot.prototype.updateStatusBarValues = function () {
    // Map and evantually crunch game_values to statusbar values, without rendering
    this.setProfiles();
    this.setCash();
    this.setAP();
    this.setKarma();
    this.setXP();
  };

  GameRoot.prototype.initGameValues = function () {
    var gv = this.data.game_values; // FIXME: Added var; check for side-effects
    this.ap_value = gv.ap_initial;
    this.ap_offset = gv.ap_offset;
    this.profiles_value = gv.profiles_value;
    this.profiles_max = gv.profiles_max;
    this.cash_value = gv.cash_value;
    // cash_max was never initialised in the legacy code, so the cash-bar
    // barsize divided by undefined → NaN. Pin to a sane large default so
    // the bar fills meaningfully without overflowing once the player
    // accumulates cash from client collections.
    this.cash_max = gv.cash_max || 10000;
    this.karma_value = gv.karma_value;
    this.karma_max = 100;
    this.xp_value = gv.xp_value;
    this.setLevel(gv.xp_level, true);
    APTicker.addListener(this);
    APTicker.start(this.ap_offset);
  };

  GameRoot.prototype.updateGameValues = function (game_values, levelup, missions, silent) {
    var gv = game_values;
    if (missions) {
      this.Missions.updateMissions(missions, game_values);
      // FIXME: TESTING when mission completed, do not yet update game_values
      //silent = true;
    }
    if (gv.profiles_max !== undefined) {
      this.profiles_max = gv.profiles_max;
    }
    if (gv.profiles_value !== undefined && gv.profiles_value !== this.profiles_value) {
      this.setProfiles(gv.profiles_value, silent);
    }
    if (gv.cash_value !== undefined && gv.cash_value !== this.cash_value) {
      this.setCash(gv.cash_value, silent);
    }
    if (gv.ap_increment) {
      this.useAP(gv.ap_increment, silent);
    }
    if (gv.karma_value !== undefined && gv.karma_value !== this.karma_value) {
      this.setKarma(gv.karma_value, silent);
    }
    if (gv.xp_value !== undefined) {
      this.setXP(gv.xp_value, silent);
    }
    // ap_snapshot is the authoritative engine AP — sync the visible
    // ap_value whenever it differs, not only on levelup. Without this,
    // the statusbar AP bar shows stale text after every chargePerp /
    // integrateCollected (handlers decrement ap_snapshot but Game.js
    // never reapplied it pre-#120 follow-up).
    if (gv.ap_snapshot !== undefined && gv.ap_snapshot !== this.ap_value) {
      this.setAP(gv.ap_snapshot, silent);
    }
    // levelup-only side effects.
    if (gv.ap_snapshot !== undefined && levelup === true && !silent) {
      this.getDatabase().checkNotifications();
      this.makeNotifications({ levelup: this.xp_level.number });
    }
  };

  GameRoot.prototype.useAP = function (inc) {
    this.setAP(this.ap_value + inc);
  };

  var sb; // Added declaration; check for side-effects
  GameRoot.prototype.setAP = function (num, silent) {
    if (num !== undefined) {
      this.ap_value = num;
    }
    if (this.ap_value > this.xp_level.ap_max) {
      this.ap_value = this.xp_level.ap_max;
    }
    sb = this.data.status_bar;
    // Only clip AP display: internally it can be -1 since that's the server's bonus
    var clipap = this.ap_value < 0 ? 0 : this.ap_value;
    sb.AP.val = this.ap_value < 0 ? 0 : this.ap_value;
    sb.AP.max = this.xp_level.ap_max;
    sb.AP.barsize = Math.min(
      120,
      Math.max(0, Math.round((sb.AP.val / this.xp_level.ap_max) * 120))
    );
    // Always invoke FXUpdate*: the Statusbar template binds the flat
    // AP_val prop, which only refreshes inside FXUpdateAP. Skipping it
    // on silent paths leaves the rendered DOM stale (issue #153).
    if (this.renderStatusbar) {
      this.renderStatusbar.FXUpdateAP(silent);
    }
  };

  GameRoot.prototype.setCash = function (num, silent) {
    if (num !== undefined) {
      this.cash_value = num;
    }
    sb = this.data.status_bar;
    sb.cash.val = this.cash_value;
    sb.cash.barsize = Math.min(
      120,
      Math.max(0, Math.round((this.cash_value / this.cash_max) * 120))
    );
    if (this.renderStatusbar) {
      this.renderStatusbar.FXUpdateCash(silent);
    }
  };

  GameRoot.prototype.setProfiles = function (num, silent) {
    if (num !== undefined) {
      this.profiles_value = num;
    }
    if (this.profiles_value > this.profiles_max) {
      this.profiles_value = this.profiles_max;
    }
    sb = this.data.status_bar;
    sb.profiles.val = this.profiles_value;
    sb.profiles.max = this.profiles_max;
    sb.profiles.barsize = Math.min(
      120,
      Math.max(0, Math.round((this.profiles_value / this.profiles_max) * 120))
    );
    sb.profiles.crosssum = this.getDBTokensCrossSum();
    this.getDBTokensLength();
    sb.profiles.tokenslength = this.DBTokensLength;
    sb.profiles.tokenslengthmax = this.DBTokensLengthMax;
    if (this.renderStatusbar) {
      this.renderStatusbar.FXUpdateProfiles(silent);
    }
  };

  GameRoot.prototype.setKarma = function (num, silent) {
    // FIXME TEST values
    //num = 33;
    if (num !== undefined) {
      this.karma_value = num;
    }
    if (this.karma_value > this.karma_max) {
      this.karma_value = this.karma_max;
    }
    if (this.karma_value < -this.karma_max) {
      this.karma_value = -this.karma_max;
    }

    sb = this.data.status_bar;
    sb.karma.val = this.karma_value;
    sb.karma.max = this.karma_max || 100;
    //var val_center = 50 - this.karma_value;
    //FIXME: set to correct level not 50;
    sb.karma.barsize = Math.min(
      59,
      Math.max(-59, Math.round((this.karma_value / this.karma_max) * 59))
    );
    if (this.renderStatusbar) {
      this.renderStatusbar.FXUpdateKarma(silent);
    }
  };

  GameRoot.prototype.setXP = function (num, silent) {
    if (num !== undefined) {
      if (num > this.xp_value) {
        this.xp_value = num;
      }
    }
    if (this.xp_value > this.xp_level.xp_max) {
      this.setLevel(this.getLevelByXP(this.xp_value).number);
    }
    if (this.xp_value < this.xp_level.xp_min) {
      this.setLevel(this.getLevelByXP(this.xp_value).number);
    }
    sb = this.data.status_bar;
    sb.XP.val = this.xp_value;
    sb.XP.level = this.xp_level.number;
    sb.XP.barsize = Math.min(
      96,
      Math.max(
        0,
        Math.round(
          ((this.xp_value - this.xp_level.xp_min) / (this.xp_level.xp_max - this.xp_level.xp_min)) *
            96
        )
      )
    );
    if (this.renderStatusbar) {
      this.renderStatusbar.FXUpdateXP(silent);
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
  // IIFE re-exposes it as Game.Database.  Database's dynamic
  // `Game[node.game_type]` and `Game.TokenPerp` lookups are routed
  // through scripts/game/perpRegistry.ts; setPerpClasses(Game) is
  // called at the bottom of this IIFE so the registry is populated
  // before any Database method runs.

  // updateGears was scoped to the Database section in legacy
  // (`// TODO: Move this to GameRoot`) but is a GameRoot prototype mixin.
  // Kept here at GameRoot scope so all the GameRoot.prototype.X
  // assignments stay together.
  GameRoot.prototype.updateGears = function () {
    _.each(getByType('TokenPerp'), function (t) {
      t.updateGear();
    });
  };

  ///////////////////////////////////
  // The GamePerp Base Class
  ///////////////////////////////////
  //
  // Extracted to scripts/game/GamePerp.ts in PR 11 of issue #147.  The
  // class is imported above; the API publisher at the bottom of this
  // IIFE re-exposes it as Game.GamePerp.  The dynamic
  // `Game[node.game_type]` lookup in BuyPerp is routed through
  // scripts/game/perpRegistry.ts (registered via setPerpClasses(Game)
  // at the IIFE's tail).  AniTicker is injected via setAniTicker(AniTicker)
  // at the same spot so GamePerp can subscribe to charge-running animations.

  GameNode.prototype.initPopupEvents = function (popup) {
    var gnode = this;
    var groot = this.GameRoot;

    var popup = popup || gnode.renderPopup;

    if (!popup) {
      return;
    }

    popup.on('button_click.MainButton', function (e) {
      e.stopPropagation();
      popup.trigger('popup_close');
    });

    popup.on('button_click.ChargeButton', function (e) {
      e.stopPropagation();
      gnode.Charge();
    });

    popup.on('button_click.CollectButton', function (e) {
      e.stopPropagation();
      gnode.collect();
    });

    popup.on('popup_close', function (e) {
      e.stopPropagation();
      if (popup.notificationMission) {
        var gestalt = popup.notificationMission;
        popup.notificationMission = null;
        // No optimistic raw_data write: dismissMissionBriefing emits a
        // delta whose listener echo lands synchronously in this tick
        // (closes #116 race window under the #120 architectural fix).
        if (app.remote && app.remote.dismissMissionBriefing) {
          app.remote.dismissMissionBriefing(gestalt);
        }
      }
      if (gnode.highlightTabs) {
        gnode.highlightTabs = [];
      }
      if (gnode.renderNode && gnode.renderNode.DecoratorNew) {
        _.each(getAllByGestalt(gnode.gestalt), function (gn) {
          gn.renderNode.DecoratorNew.remove();
        });
      }
      if (popup.callback) {
        popup.close(popup.callback);
      } else {
        popup.close();
      }
      delete gnode.renderPopup;
    });

    popup.on('button_click.PowerupBuyButton', function (e, bgestalt, bslot) {
      e.stopPropagation();
      gnode.BuyPowerup(bgestalt, bslot);
    });

    popup.on('button_click.PowerupBuySlotsButton', function (e, bgestalt, bslot) {
      e.stopPropagation();
      gnode.BuySlots(bslot, bgestalt);
    });

    popup.on('button_click.PowerupSellButton', function (e, bgestalt, bslot) {
      e.stopPropagation();
      gnode.SellPowerup(bgestalt, bslot);
    });

    popup.on('popup_token_seen', function (e, gestalt) {
      e.stopPropagation();
      if (!gestalt) {
        return;
      }
      // No optimistic raw_data write: markTokenSeen emits a delta whose
      // listener echo lands synchronously (closes #116 race window
      // under the #120 architectural fix). The handler itself short-
      // circuits when the gestalt is already in tokens_seen, so calling
      // it twice is a no-op delta.
      if (app.remote && app.remote.markTokenSeen) {
        app.remote.markTokenSeen(gestalt);
      }
    });

    popup.on('button_click.PerpBuyButton', function (e, bgestalt) {
      e.stopPropagation();
      var gtype = groot.getTypeFromGestalt(bgestalt);
      if (gtype === 'CityPerp') {
        var DBPerp = getByType('DatabasePerp');
        if (DBPerp.length) {
          DBPerp = DBPerp[0];
        } else {
          return;
        }
        return DBPerp.BuyCity(bgestalt);
      } else {
        gnode.BuyPerp(bgestalt);
      }
    });

    popup.on('button_click.UpgradeButton', function (e) {
      e.stopPropagation();
      gnode.Charge();
    });

    popup.jdomelem.on('click touchend', 'a.ml', function (e) {
      e.stopPropagation();
      e.preventDefault();
      var link = $(this).attr('href');
      // FIX for FF open link in external window to prevent socketloss
      //document.location.href = link;
      window.open(link);
    });

    popup.jdomelem.on('click touchend', 'a.mln', function (e) {
      e.stopPropagation();
      e.preventDefault();
      var link = $(this).attr('href');
      window.open(link);
    });

    popup.on('button_click.RefreshButton', function (e) {
      e.stopPropagation();
      gnode.GameRoot.refresh();
    });
  };

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

  GameNode.prototype.fetchProvided = function (cb) {
    var gnode = this;
    gnode.data.providedPerps = [];
    if (gnode.popupTemplateData) {
      gnode.popupTemplateData.loading = true;
    }

    app.remote
      .getProvidedPerps(gnode.path)
      .done(function (data) {
        if (data.result && data.result.buyable) {
          gnode.data.buyablePerps = data.result.buyable;
          if (gnode.popupTemplateData) {
            gnode.popupTemplateData.loading = false;
          }
          if (cb) {
            cb();
          }
        }
      })
      .fail(function (data) {
        if (cb) {
          cb();
        }
      });
  };

  ///////////////////////////////////
  // The Agent
  ///////////////////////////////////

  var AgentPerp = function (config) {
    this.init(config);
    this.GameRoot.IPerps[this.gestalt] = true;
    return this;
  };

  extend(AgentPerp, GamePerp);

  AgentPerp.prototype.renderType = 'Perp';
  AgentPerp.prototype.cableType = 'in';
  AgentPerp.prototype.popupTemplate = 'popup_agent.html';
  AgentPerp.prototype.textNewItems = _._('New Contacts!');

  AgentPerp.prototype.extendEventHandlers = function () {
    var gnode = this;
    var groot = this.GameRoot;

    gnode.compileProvided();

    gnode.on('after_render', function (e, renderNode) {
      gnode.checkProvidedByLevel();
    });

    gnode.on('vclick', function (e, renderNode) {
      e.stopPropagation();
      gnode.fetchProvided(function () {
        gnode.compileProvided();
        if (gnode.renderPopup) {
          gnode.updatePopup();
        }
      });
      var popup = this.openPopup();
    });
  };

  ///////////////////////////////////
  // The Contact
  ///////////////////////////////////

  var ContactPerp = function (config) {
    this.init(config);
    this.GameRoot.IPerps[this.gestalt] = true;
    return this;
  };

  extend(ContactPerp, GamePerp);

  ContactPerp.prototype.renderType = 'Perp';
  ContactPerp.prototype.popupTemplate = 'popup_contact.html';
  ContactPerp.prototype.cableType = 'in';
  ContactPerp.prototype.sticky = false;

  ContactPerp.prototype.extendEventHandlers = function () {
    var gnode = this;
    var groot = this.GameRoot;

    gnode.on('vshiftclick', function (e, renderNode) {
      e.stopPropagation();
      gnode.Charge();
    });
    gnode.on('vclick', function (e, renderNode) {
      e.stopPropagation();
      // FIXME: Prepare data move this to own function
      gnode.data.ProfileSet = new ProfileSet({ markNew: true }, gnode.data.tokens);

      var popup = this.openPopup();
    });
    gnode.on('node_ready', function (e, result) {
      e.stopPropagation();
      // FIXME result has no meaning here?! since A) event can be triggered by non-socket-io b) markready takes no argument.
      //gnode.markReady(result);
      //onsole.log('node_ready',result);
      gnode.markReady();
    });
  };

  ContactPerp.prototype.Charge = function () {
    var gnode = this;
    var groot = this.GameRoot;
    // No request when not enough cash
    if (gnode.data.charge_cost > groot.cash_value) {
      // No cash
      if (gnode.renderPopup && gnode.renderPopup.open) {
        gnode.renderPopup.trigger('no_cash');
      } else {
        gnode.renderNode.FXNoCash();
      }
      return;
    }
    if (!gnode.states.chargeRunning && gnode.states.idle) {
      app.remote
        .chargePerp(gnode.path)
        .done(function (data) {
          if (data.result) {
            if (data.result.error) {
              // Error 1 = no AP (energy), Error 3 = no cash
              if (data.result.error === 1) {
                if (gnode.renderPopup && gnode.renderPopup.open) {
                  gnode.renderPopup.trigger('no_AP');
                } else {
                  gnode.renderNode.FXNoAP();
                }
              } else {
                if (gnode.renderPopup && gnode.renderPopup.open) {
                  gnode.renderPopup.trigger('no_cash');
                } else {
                  gnode.renderNode.FXNoCash();
                }
              }
              return;
            }
            if (gnode.renderPopup) {
              gnode.renderPopup.trigger('popup_close');
            }
            // TODO game_values
            var gv = data.result.game_values;
            groot.updateGameValues(
              data.result.game_values,
              data.result.levelup,
              data.result.missions
            );
            gnode.renderNode.FXCharge();
            gnode.markTimer({
              duration: data.result.duration,
              serverTime: 0,
              serverStartTime: 0,
            });
          } else {
            gnode.Error('The computer says NOOOO', data);
          }
        })
        .fail(function (data) {
          gnode.Error('The computer says NOOOO', data);
        });
    }
  };

  ContactPerp.prototype.collect = function () {
    var gperp = this;
    var groot = this.GameRoot;
    var deco = this.renderReady;
    var popup = this.renderPopup;
    if (groot.ap_value < 1) {
      if (popup) {
        popup.trigger('no_AP');
      } else {
        deco.FXNoAP();
      }
      return;
    }
    deco.setClickable(false);
    deco.setFrame('active');
    deco.FXPulse();
    //var amount = _.toKSNum(Math.round(Math.random()*100000));
    app.remote
      .collectPerp(gperp.path)
      .done(function (data) {
        // FIXME: It would be better if data.result was in a predefined state to prevent testing for both, undefined _and_ null...
        if (data.result && data.result.result) {
          var amount = data.result.result.profile_set.profiles_value;

          if (popup) {
            popup.trigger('popup_close');
          }
          groot.updateGameValues(
            data.result.game_values,
            data.result.levelup,
            data.result.missions
          );
          if (data.result.karma_incident) {
            // Karmalizer
            var karma_dec = data.result.game_values.karma_value - groot.karma_value;
            groot.makeNotifications({
              karma: {
                gestalt: data.result.karma_incident,
                dec: karma_dec,
              },
            });
          }

          deco.FXBling({ text: _.toKSNum(amount), extendClass: 'ProfileBling' });
          deco.FXSuck(function () {
            gperp.renderNode.FXDataOut();
            gperp.renderReady = undefined;
          });
          // Add to DB Queue
          //groot.getDatabase().cue(data.result.result.profile_set, data.result.result.origin, data.result.result.collect_id);
          groot
            .getDatabase()
            .cue(
              data.result.result.profile_set,
              data.result.result.origin,
              data.result.result.collect_id
            );
          gperp.setState('idle', true);
        } else if (data.result && data.result.error) {
          if (popup) {
            popup.trigger('no_AP');
          } else {
            deco.FXNoAP();
          }
          deco.FXStop();
          deco.setClickable(true);
          deco.setFrame('normal');
          console.warn('collect failed');
        } else {
          // ERROR
          gperp.Error('The computer says NOOOO', data);
        }
      })
      .fail(function (data) {
        deco.FXError();
        deco.FXStop();
        deco.setClickable(true);
        deco.setFrame('normal');
      });
  };

  ContactPerp.prototype.markReady = function () {
    var gperp = this;
    var groot = this.GameRoot;
    gperp.setState('idle', false);
    gperp.setState('chargeRunning', false);
    if (gperp.renderTimer) {
      gperp.renderTimer.FXPuff();
    }
    var deco = (this.renderReady = this.renderNode.addDecorator(new Render.DecoratorReady()));
    deco.FXSproing();
    deco.on('vclick', function (e, renderNode) {
      e.stopPropagation();
      gperp.collect();
      // No Request when no AP
    });
  };

  /*
    ContactPerp.prototype.AniTick = function() {
      if (this.renderNode) {
        this.renderNode.FXBounce();
      }
    };
    */

  ///////////////////////////////////
  // The Pusher
  ///////////////////////////////////

  var PusherPerp = function (config) {
    this.init(config);
    this.GameRoot.IPerps[this.gestalt] = true;
    return this;
  };

  extend(PusherPerp, GamePerp);

  PusherPerp.prototype.renderType = 'Perp';
  PusherPerp.prototype.cableType = 'out';
  PusherPerp.prototype.labelClass = 'client';
  PusherPerp.prototype.popupTemplate = 'popup_pusher.html';
  PusherPerp.prototype.textNewItems = _._('New Clients!');

  PusherPerp.prototype.extendEventHandlers = function () {
    var gnode = this;
    var groot = this.GameRoot;

    gnode.compileProvided();

    gnode.on('after_render', function (e, renderNode) {
      gnode.checkProvidedByRequiredPerps();
    });

    gnode.on('vclick', function (e, renderNode) {
      e.stopPropagation();
      gnode.fetchProvided(function () {
        gnode.compileProvided();
        if (gnode.renderPopup) {
          gnode.updatePopup();
        }
      });
      var popup = this.openPopup();
    });
  };

  ///////////////////////////////////
  // The Client (former Customer)
  ///////////////////////////////////

  var ClientPerp = function (config) {
    this.init(config);
    this.GameRoot.IPerps[this.gestalt] = true;
    return this;
  };

  extend(ClientPerp, GamePerp);

  ClientPerp.prototype.renderType = 'Perp';
  ClientPerp.prototype.cableType = 'out';
  ClientPerp.prototype.labelClass = 'client';
  ClientPerp.prototype.sticky = false;
  ClientPerp.prototype.popupTemplate = 'popup_client.html';

  /* NEW

class CollectableClient(CollectablePerpBase):

    def getCost(self):
        return {'ap': 1}

    def getPerpChargeData(self):
        db_state = self.getDBAmounts()
        token_amounts = [float(db_state.get(token['gestalt'], 0) * token['amount'])/10000 for token in self.node_type_data['consumed_tokens']]
        amount = sum(token_amounts, 0)
        db_fill_factor = self.getDBFactorNormalized(db_state)
        karma_penalty_factor = self.getKarmaPenalty()
        amount = (amount * db_fill_factor)**0.6
        result = int(karma_penalty_factor * round((self.node_type_data['income_base'] + (amount * self.node_type_data['income_base'] * (float(self.node_type_data['income_factor'])/1000)))/10)*10)
        return {'collect_cash': result}, self.getCost()

    def getKarmaPenalty(self):
        karma = self.game_values.get('karma_value', 0)
        karma_factor = float(karma + 100)/200 + 0.5
        return min(1, karma_factor)

*/

  ClientPerp.prototype.AniTick = function () {
    if (this.renderNode) {
      this.renderNode.FXDataIn();
    }
  };

  ClientPerp.prototype.getKarmaPenalty = function () {
    var groot = this.GameRoot;
    var karma = groot.karma_value;
    var karma_factor = (karma + 100) / 200 + 0.5;
    karma_factor = karma_factor > 1 ? 1 : karma_factor;
    if (karma_factor < 1) {
      this.data.karma_penalty = true;
    } else {
      this.data.karma_penalty = false;
    }
    return karma_factor;
  };

  /*
     def getPerpChargeData(self):
        db_state = self.getDBAmounts()
        token_amounts = [float(db_state.get(token['gestalt'], 0) * token['amount'])/10000 for token in self.node_type_data['consumed_tokens']]
        amount = sum(token_amounts, 0)
        db_fill_factor = self.getDBFactorNormalized(db_state)
        karma_penalty_factor = self.getKarmaPenalty()
        amount = (amount * db_fill_factor)**0.6
        #result = int(karma_penalty_factor * round((self.node_type_data['income_base'] + (amount * self.node_type_data['income_base'] * (float(self.node_type_data['income_factor'])/1000)))/10)*10)
        result = int(karma_penalty_factor * round((self.node_type_data['income_base'] + (amount * self.node_type_data['income_base'] * (float(self.node_type_data['income_factor'])/1000)))))
        return {'collect_cash': result}, self.getCost()
*/

  ClientPerp.prototype.getIncome = function (nopenalty) {
    var groot = this.GameRoot;
    var base_income = this.data.income_base;
    var base_income_factor = this.data.income_factor;
    var consumed_tokens = this.data.consumed_tokens;
    var db_profiles = groot.DBTokens;
    var sum = [];
    _.each(consumed_tokens, function (token, k) {
      sum.push((groot.getDBTokenAmount(token.gestalt) * token.amount) / 10000);
    });
    var amount = 0;
    amount = _.reduce(
      sum,
      function (memo, num) {
        return memo + num;
      },
      0
    );
    var db_fill_factor = groot.getDBFactorNormalized();
    var karma_penalty_factor = nopenalty ? 1 : this.getKarmaPenalty();
    amount = (amount * db_fill_factor) ** 0.6;
    //var result = parseInt( karma_penalty_factor * Math.round( (base_income + (amount * base_income * (base_income_factor/1000))) /10 ) * 10 );
    var result = Number.parseInt(
      karma_penalty_factor *
        Math.round(base_income + amount * base_income * (base_income_factor / 1000))
    );
    return result;
  };

  GameRoot.prototype.getCityOriginAmounts = function () {
    var cities = _.where(this.DBOriginTokens, { originGameType: 'CityPerp' });
    var city_amounts = {};
    _.each(cities, function (c) {
      city_amounts[c.gestalt] = c.cityMaxAmount;
    });
    return city_amounts;
  };

  GameRoot.prototype.getDBFactorNormalized = function () {
    var cityamounts = this.getCityOriginAmounts();
    return _.reduce(
      _.values(cityamounts),
      function (memo, num) {
        return memo + num;
      },
      0
    );
  };

  ClientPerp.prototype.extendEventHandlers = function () {
    var gnode = this;

    gnode.on('vshiftclick', function (e, renderNode) {
      e.stopPropagation();
      gnode.Charge();
    });

    gnode.on('vclick', function (e, renderNode) {
      e.stopPropagation();

      // FIXME: Compile some data, move to extra method
      //gnode.data.ProfileSet = new ProfileSet({ convertTokens:true, DBAmounts:true, lockNotInDB:true }, gnode.data.provided_tokens);
      gnode.data.ProfileSet = new ProfileSet(
        { DBAmounts: true, lockNotInDB: true, filter_is_query: 'blue', sortByGestalt: true },
        gnode.data.consumed_tokens
      );
      gnode.data.ConsumedProfileSet = new ProfileSet(
        { lockNotInDB: true, DBAmounts: true, filter_is_query: 'orange', sortByGestalt: true },
        gnode.data.consumed_tokens
      );
      gnode.data.income = gnode.getIncome();
      gnode.data.income_nopenalty = gnode.getIncome(true);

      var popup = this.openPopup();
    });

    gnode.on('node_ready', function (e, result) {
      e.stopPropagation();
      gnode.markReady();
    });
  };

  ClientPerp.prototype.collect = function () {
    var gperp = this;
    var groot = this.GameRoot;
    var deco = gperp.renderReady;
    // No Request when no AP
    var popup = gperp.renderPopup;
    // No Request when no AP
    if (groot.ap_value < 1) {
      if (popup) {
        popup.trigger('no_AP');
      } else {
        deco.FXNoAP();
      }
      return;
    }
    deco.setClickable(false);
    deco.setFrame('active');
    deco.FXPulse();
    //var amount = _.toKSNum(Math.round(Math.random()*100000));
    app.remote
      .collectPerp(gperp.path)
      .done(function (data) {
        // FIXME: It would be better if data.result was in a predefined state to prevent testing for both, undefined _and_ null...
        if (data.result && data.result.result) {
          var amount = data.result.result.cash;

          if (popup) {
            popup.trigger('popup_close');
          }

          groot.updateGameValues(
            data.result.game_values,
            data.result.levelup,
            data.result.missions
          );
          deco.FXBling({ text: '$' + _.toKSNum(amount), extendClass: 'MoneyBling', wait: 600 });

          if (data.result.karma_incident) {
            // Karmalizer
            var karma_dec = data.result.game_values.karma_value - groot.karma_value;
            groot.makeNotifications({
              karma: {
                gestalt: data.result.karma_incident,
                dec: karma_dec,
              },
            });
          }
          deco.FXKatsching(function () {
            gperp.renderReady.remove();
            gperp.renderReady = undefined;
            delete gperp.renderReady;
          });

          gperp.setState('idle', true);
        } else if (data.result && data.result.error) {
          if (popup) {
            popup.trigger('error');
          } else {
            deco.FXError();
          }
          deco.FXStop();
          deco.setClickable(true);
          deco.setFrame('normal');
          console.warn('collect failed', data.result.error);
        } else {
          // ERROR
          gperp.Error('The computer says NOOOO', data);
        }
      })
      .fail(function (data) {
        deco.FXError();
        deco.FXStop();
        deco.setClickable(true);
        deco.setFrame('normal');
      });
  };

  ClientPerp.prototype.markReady = function () {
    var gperp = this;
    var groot = this.GameRoot;
    gperp.setState('idle', false);
    gperp.setState('chargeRunning', false);
    if (gperp.renderTimer) {
      gperp.renderTimer.FXPuff();
    }

    var deco = (gperp.renderReady = new Render.DecoratorReady({ mode: 'money' }));
    gperp.renderNode.addDecorator(deco);
    deco.FXSproing();

    deco.on('vclick', function (e, renderNode) {
      e.stopPropagation();
      gperp.collect();
    });
  };

  ClientPerp.prototype.Charge = function () {
    var gnode = this;
    var groot = this.GameRoot;
    // No request when not enough cash
    if (groot.ap_value < 1) {
      // No AP
      if (gnode.renderPopup && gnode.renderPopup.open) {
        gnode.renderPopup.trigger('no_AP');
      } else {
        gnode.renderNode.FXNoAP();
      }
      return;
    }
    if (!gnode.states.chargeRunning && gnode.states.idle) {
      app.remote
        .chargePerp(gnode.path)
        .done(function (data) {
          if (data.result) {
            if (data.result.error) {
              // No AP
              if (gnode.renderPopup && gnode.renderPopup.open) {
                gnode.renderPopup.trigger('no_AP');
              } else {
                gnode.renderNode.FXAP();
              }
              return;
            }
            if (gnode.renderPopup) {
              gnode.renderPopup.trigger('popup_close');
            }

            gnode.renderNode.FXDataIn();
            // TODO game_values
            var gv = data.result.game_values;
            groot.updateGameValues(
              data.result.game_values,
              data.result.levelup,
              data.result.missions
            );
            gnode.renderNode.FXCharge('AP');
            gnode.markTimer({
              duration: data.result.duration,
              serverTime: 0,
              serverStartTime: 0,
            });
          } else {
            gnode.Error('The computer says NOOOO', data);
          }
        })
        .fail(function (data) {
          gnode.Error('The computer says NOOOO', data);
        });
    }
  };

  ///////////////////////////////////
  // The Proxy
  ///////////////////////////////////

  var ProxyPerp = function (config) {
    this.init(config);
    this.GameRoot.IPerps[this.gestalt] = true;
    return this;
  };

  extend(ProxyPerp, GamePerp);

  ProxyPerp.prototype.renderType = 'Perp';
  ProxyPerp.prototype.cableType = 'in';
  ProxyPerp.prototype.popupTemplate = 'popup_proxy.html';
  ProxyPerp.prototype.textNewItems = _._('New Ventures!');

  ProxyPerp.prototype.extendEventHandlers = function () {
    var gnode = this;
    var groot = this.GameRoot;

    gnode.compileProvided();

    gnode.on('after_render', function (e, renderNode) {
      gnode.checkProvidedByLevel();
    });

    gnode.on('vclick', function (e, renderNode) {
      e.stopPropagation();
      gnode.data.used_slots = gnode.children.set.length;
      gnode.fetchProvided(function () {
        gnode.compileProvided();
        if (gnode.renderPopup) {
          gnode.updatePopup();
        }
      });
      var popup = this.openPopup();
    });

    gnode.on('after_render', function () {
      gnode.updateRenderSlotStatus();
    });
  };

  ProxyPerp.prototype.updateRenderSlotStatus = function () {
    var node = this.renderNode;
    this.data.used_slots = this.children.set.length;
    if (this.data.used_slots < this.data.max_slots) {
      node.addDecorator(
        new Render.DecoratorLabel({
          text: this.data.label + '<br />' + this.data.used_slots + '/' + this.data.max_slots,
        })
      );
    } else {
      node.addDecorator(new Render.DecoratorLabel({ text: this.data.label }));
    }
  };

  ///////////////////////////////////
  // The Project
  ///////////////////////////////////

  var ProjectPerp = function (config) {
    this.init(config);
    this.GameRoot.IPerps[this.gestalt] = true;
    return this;
  };

  extend(ProjectPerp, GamePerp);

  ProjectPerp.prototype.renderType = 'Perp';
  ProjectPerp.prototype.cableType = 'in';
  ProjectPerp.prototype.sticky = false;
  ProjectPerp.prototype.popupTemplate = 'popup_project.html';
  ProjectPerp.prototype.textNewItems = _._('New Powerups!');

  ProjectPerp.prototype.compileProfileSet = function () {
    this.data.ProfileSet = new ProfileSet(
      { markNew: true, lockAmountZero: true },
      this.data.tokens
    );
  };

  ProjectPerp.prototype.extendEventHandlers = function () {
    var gnode = this;
    var groot = this.GameRoot;

    gnode.on('vshiftclick', function (e, renderNode) {
      e.stopPropagation();
      gnode.Charge();
    });

    gnode.on('vclick', function (e, renderNode) {
      e.stopPropagation();

      var popup = this.openPopup();

      gnode.fetchPowerups(function () {
        gnode.compilePowerups();
        gnode.compileProfileSet();
        if (gnode.renderPopup) {
          gnode.updatePopup();
        }
      });
    });

    gnode.on('node_ready', function (e, result) {
      e.stopPropagation();
      gnode.markReady();
    });
  };

  /*
    ProjectPerp.prototype.AniTick = function() {
      if (this.renderNode) {
        this.renderNode.FXBounce();
      }
    };
    */

  ProjectPerp.prototype.fetchPowerups = function (cb) {
    this.GameRoot.fetchProjectPowerupData(this.gestalt, cb);
    return;
    // biome-ignore lint/correctness/noUnreachable: legacy dead code, kept as reference for future re-enable
    var gnode = this;
    // Register Powerups in typeRegistry if opend for the first time move this to compilePowerupsa
    if (!gnode.data.powerups_compiled) {
      app.remote.getPowerups(gnode.gestalt, app.version).done(function (data) {
        _.each(data.result, function (v, k) {
          gnode.addType(v.game_gestalt, v);
        });
        if (gnode.renderPopup) {
          // FIXME: get rid of caching flag for now?
          gnode.renderPopup.templateData.cached = true;
          // FIXME: only update tabs don't redraw everything
          //gnode.compilePowerups();
          //gnode.updatePopup();
          if (cb) {
            cb();
          }
        }
      });
    } else {
      if (cb) {
        cb();
      }
    }
  };

  GameRoot.prototype.fetchProjectPowerupData = function (project_gestalt, cb) {
    var groot = this;
    var gnode = getByGestalt(project_gestalt);
    // Register Powerups in typeRegistry
    if (gnode && !gnode.data.powerupsCached) {
      app.remote.getPowerups(project_gestalt, app.version).done(function (data) {
        _.each(data.result, function (v, k) {
          groot.addSubType(project_gestalt, v.game_gestalt, v);
        });
        if (gnode.renderPopup) {
          gnode.renderPopup.templateData.cached = true;
        }
        gnode.data.powerupsCached = true;
        if (cb) {
          cb();
        }
      });
    } else if (gnode && gnode.renderPopup && gnode.renderPopup.templateData) {
      gnode.renderPopup.templateData.cached = true;
      if (cb) {
        cb();
      }
    } else {
      app.remote.getPowerups(project_gestalt, app.version).done(function (data) {
        _.each(data.result, function (v, k) {
          groot.addSubType(project_gestalt, v.game_gestalt, v);
        });
        if (cb) {
          cb();
        }
      });
    }
  };

  ProjectPerp.prototype.compilePowerups = function () {
    var gnode = this;
    var powerups = {};
    if (gnode.data) {
      _.each(gnode.data.provided_ads, function (powerup) {
        powerup.data = mergeData(gnode.getType(powerup.gestalt).type_data, powerup.instance_data);
        powerup.game_type = gnode.getType(powerup.gestalt).game_type;
      });
      _.each(gnode.data.provided_upgrades, function (powerup) {
        powerup.data = mergeData(gnode.getType(powerup.gestalt).type_data, powerup.instance_data);
        powerup.game_type = gnode.getType(powerup.gestalt).game_type;
      });
      _.each(gnode.data.provided_teammembers, function (powerup) {
        powerup.data = mergeData(gnode.getType(powerup.gestalt).type_data, powerup.instance_data);
        powerup.game_type = gnode.getType(powerup.gestalt).game_type;
      });
      _.each(gnode.data.powerups, function (powerup) {
        gnode.removeProvidedPowerup(powerup.gestalt);
        if (gnode.getType(powerup.gestalt)) {
          powerup.data = mergeData(gnode.getType(powerup.gestalt).type_data, powerup.instance_data);
          powerup.game_type = gnode.getType(powerup.gestalt).game_type;
        } else {
          console.warn('Error no type_data', powerup.gestalt);
        }
      });
    }

    _.each(['UpgradePowerup', 'AdPowerup', 'TeamMemberPowerup'], function (game_type) {
      var pcat = convertPowerupType(game_type);
      if (!powerups[game_type]) {
        // init powerup slots
        powerups[game_type] = {
          slots: [],
          provided: [],
          typelower: pcat,
          slots_left: gnode.data['max_' + pcat + '_slots'] - gnode.data[pcat + '_slots'],
        };
        var slotslen = 0;
        var provided = [];
        if (game_type === 'UpgradePowerup') {
          slotslen = gnode.data.upgrade_slots;
          powerups[game_type].provided = _.filter(gnode.data.provided_upgrades, function (p) {
            return p.bought !== true;
          });
        } else if (game_type === 'AdPowerup') {
          slotslen = gnode.data.ad_slots;
          powerups[game_type].provided = _.filter(gnode.data.provided_ads, function (p) {
            return p.bought !== true;
          });
        } else if (game_type === 'TeamMemberPowerup') {
          slotslen = gnode.data.teammember_slots;
          powerups[game_type].provided = _.filter(gnode.data.provided_teammembers, function (p) {
            return p.bought !== true;
          });
        }
        // adding slots to override default game inconsistencies
        var slots = [];
        var pagesize = 10;
        var pages = Math.ceil(slotslen / pagesize);
        _.each(_.range(0, slotslen), function (v) {
          slots[v] = 'free';
        });
        // TODO: only add locked if slots < max_length of slots
        if (powerups[game_type].slots_left > 0) {
          slots.push('locked');
        }
        powerups[game_type].slots = slots;
      }
    });
    _.each(gnode.data.powerups, function (p) {
      // No game type? abort.
      if (!p.game_type) {
        return;
      }
      // test if slot is free - THIS SHOULD NOT HAPPEN!
      if (powerups[p.game_type].slots[p.slot] === 'free') {
        powerups[p.game_type].slots[p.slot] = p;
      }
    });
    gnode.data.powerups_compiled = powerups;
  };

  ProjectPerp.prototype.removeProvidedPowerup = function (bgestalt) {
    var provided = {
      provided_ads: this.data.provided_ads,
      provided_upgrades: this.data.provided_upgrades,
      provided_teammembers: this.data.provided_teammembers,
    };
    _.each(provided, function (p, key) {
      var deleteme = _.findWhere(p, { gestalt: bgestalt });
      if (deleteme) {
        deleteme.bought = true;
        //gnode.data[key] = _.without(p, deleteme);
      }
    });
  };

  ProjectPerp.prototype.addProvidedPowerup = function (bgestalt) {
    var provided = {
      provided_ads: this.data.provided_ads,
      provided_upgrades: this.data.provided_upgrades,
      provided_teammembers: this.data.provided_teammembers,
    };
    _.each(provided, function (p, key) {
      var addme = _.findWhere(p, { gestalt: bgestalt });
      if (addme) {
        addme.bought = false;
      }
    });
  };

  GameNode.prototype.Error = function (errormsg, data) {
    var groot = this.GameRoot;
    if (this.renderPopup && this.renderPopup.open) {
      this.renderPopup.trigger('error');
    } else if (this.renderNode) {
      this.renderNode.FXError();
    } else if (groot) {
      groot.renderNode.FXError();
    }
    if (setup.debug) {
      console.error(errormsg, data);
    }
  };

  GameNode.prototype.NoCash = function () {
    if (this.renderPopup && this.renderPopup.open) {
      this.renderPopup.trigger('no_cash');
    } else {
      this.renderNode.FXNoCash();
    }
  };

  GameNode.prototype.NoAP = function () {
    if (this.renderPopup && this.renderPopup.open) {
      this.renderPopup.trigger('no_AP');
    } else {
      this.renderNode.FXNoAP();
    }
  };

  ProjectPerp.prototype.BuyPowerup = function (bgestalt, bslot) {
    var gnode = this;
    var groot = this.GameRoot;
    // TODO: backendcall and do purchase...
    if (bgestalt === undefined || bslot === undefined) {
      gnode.Error('Buy powerup is missing parameters');
      return;
    }
    if (bgestalt.split(':')[0] === 'buyslots') {
      gnode.BuySlots(bslot, bgestalt);
      return;
    }
    app.remote
      .buyPowerup(gnode.path, bslot, bgestalt)
      .done(function (data) {
        if (data.result) {
          if (data.result.error !== undefined) {
            var buyErrors = {
              0: 'node or powerup type not found',
              1: 'slot already occupied',
              3: 'insufficient cash',
            };
            var buyDetail = data.result.error === 3 ? ' (cash: ' + groot.cash_value + ')' : '';
            console.log(
              '[BuyPowerup] failed:',
              (buyErrors[data.result.error] || 'unknown error ' + data.result.error) + buyDetail,
              '| path:',
              gnode.path,
              '| slot:',
              bslot,
              '| gestalt:',
              bgestalt,
              data
            );
            if (data.result.error === 3) {
              gnode.NoCash();
            } else {
              gnode.Error('The computer says NOOOO', data);
            }
            return;
          }
          groot.updateGameValues(
            data.result.game_values,
            data.result.levelup,
            data.result.missions
          );
          gnode.data = mergeData(gnode.data, data.result.node.instance_data);
          gnode.removeProvidedPowerup(bgestalt);
          gnode.compilePowerups();
          gnode.compileProfileSet();
          gnode.renderPopup.trigger('close_powerup', function () {
            // NOTE: close_powerup has callback with timeout
            gnode.updatePopupGracefully(bslot, bgestalt);
          });
        } else {
          // Server Error
          gnode.Error('The computer says NOOOO', data);
        }
      })
      .fail(function (data) {
        if (data.error && data.error.message) {
          gnode.Error(data.error.message, data);
        } else {
          gnode.Error('The computer says NOOOO', data);
        }
      });
  };

  ProjectPerp.prototype.SellPowerup = function (bgestalt, bslot) {
    var gnode = this;
    var groot = this.GameRoot;
    // TODO: backendcall and do purchase...

    app.remote
      .sellPowerup(gnode.path, Number.parseInt(bslot), bgestalt)
      .done(function (data) {
        if (data.result) {
          if (data.result.error !== undefined) {
            gnode.Error('The computer says NOOOO', data);
            return;
          }
          groot.updateGameValues(
            data.result.game_values,
            data.result.levelup,
            data.result.missions
          );
          //gnode.data = mergeData(gnode.data, data.result.node.instance_data);
          gnode.data = mergeData(groot.getTypeData(gnode.gestalt), data.result.node.instance_data);
          gnode.addProvidedPowerup(bgestalt);
          gnode.compilePowerups();
          gnode.compileProfileSet();
          gnode.renderPopup.trigger('close_powerup', function () {
            gnode.updatePopupGracefully(bslot, bgestalt, true);
          });
        } else {
          // Server Error
          gnode.Error('The computer says NOOOO', data);
        }
      })
      .fail(function (data) {
        if (data.error && data.error.message) {
          gnode.Error(data.error.message, data);
        } else {
          gnode.Error('The computer says NOOOO', data);
        }
      });
  };

  ProjectPerp.prototype.BuySlots = function (num, bgestalt) {
    var pcat = convertPowerupType(bgestalt.split(':')[1]);
    num = Number.parseInt(num, 10) || 1;

    var gnode = this;
    var groot = this.GameRoot;

    var slotKey = pcat + '_slots';
    var maxKey = 'max_' + pcat + '_slots';
    var currentSlots = gnode.data[slotKey] || 0;
    var maxSlots = gnode.data[maxKey];
    if (maxSlots != null && currentSlots + num > maxSlots) {
      console.log(
        '[BuySlots] blocked: max slots reached (have ' +
          currentSlots +
          ', max ' +
          maxSlots +
          ', tried to add ' +
          num +
          ')'
      );
      gnode.Error('Max slots reached', {});
      return;
    }

    app.remote
      .buySlots(gnode.path, pcat, num)
      .done(function (data) {
        if (data.result) {
          if (data.result.error !== undefined) {
            var slotErrors = {
              0: 'node or slot type not found',
              2: 'max slots already reached',
              3: 'insufficient cash',
            };
            var slotDetails = {
              2: ' (have ' + currentSlots + ', max ' + maxSlots + ', tried to add ' + num + ')',
              3: ' (cash: ' + groot.cash_value + ')',
            };
            console.log(
              '[BuySlots] failed:',
              (slotErrors[data.result.error] || 'unknown error ' + data.result.error) +
                (slotDetails[data.result.error] || ''),
              '| path:',
              gnode.path,
              '| type:',
              pcat,
              '| num:',
              num,
              data
            );
            if (data.result.error === 2) {
              gnode.Error('Max slots reached', data);
            } else {
              gnode.NoCash();
            }
            return;
          }
          groot.updateGameValues(
            data.result.game_values,
            data.result.levelup,
            data.result.missions
          );
          gnode.data = mergeData(gnode.data, data.result.node.instance_data);
          gnode.compilePowerups();
          // FIXME: do this gracefully
          gnode.renderPopup.trigger('close_powerup', function () {
            gnode.updatePopup();
          });
        } else {
          // Server Error
          gnode.Error('The computer says NOOOO', data);
        }
      })
      .fail(function (data) {
        if (data.error && data.error.message) {
          gnode.Error(data.error.message, data);
        } else {
          gnode.Error('The computer says NOOOO', data);
        }
      });
  };

  ProjectPerp.prototype.updatePopupGracefully = function (bslot, bgestalt, selling) {
    var pcat = getPowerupTypeFromGestalt(bgestalt);
    this.updateTemplateData();
    if (this.popupTemplateData) {
      this.popupTemplateData.loading = false;
    }

    if (!this.renderPopup) {
      return;
    }

    var popup = this.renderPopup;
    popup.renderDataTab();
    popup.renderPowerupSelectors(pcat);

    var jpop = this.renderPopup.jdomelem;
    var jtab = jpop.find('.PopupTab[data-tab="' + pcat + '"]');
    if (!selling) {
      // Buying a Powerup
      var slot = jtab.find('.Powerup.free[data-button-data="' + bslot + '"]');
      slot.removeAttr('data-subpop-id');
      var powerup = _.findWhere(this.data.powerups, { gestalt: bgestalt });
      var jpowerup = _.renderView('powerup.html', {
        powerup: powerup,
        slot: bslot,
        key: pcat + bslot,
        updating: true,
      });
      jtab.find('.Subpop[data-subpop-id="' + pcat + bslot + '"]').remove();
      var jpowerupSubpop = _.renderView('subpop_powerup.html', {
        powerup: powerup,
        slot: bslot,
        key: pcat + bslot,
      });
      jtab.find('.SubpopContainer').append(jpowerupSubpop);

      var parsed = $.parseHTML(jpowerup);
      slot.addClass('updating hide ');
      window.setTimeout(function () {
        slot.replaceWith(parsed);
        slot = jtab.find('.Powerup.updating[data-button-data="' + bslot + '"]');
        window.setTimeout(function () {
          slot.removeClass('updating').addClass('taken new');
        }, 400);
      }, 400);
      /*
        window.setTimeout(function(){
          slot = jtab.find('.Powerup.updating[data-button-data="'+bslot+'"]');
          slot.find('.PowerupBackground').delay(400).fadeOut(150,function(){
            slot.removeClass('updating').addClass('taken new');
          }).fadeIn(250);
        },800);
        */
    } else {
      // Selling a Powerup
      //gnode.updatePopup();
      var slot = jtab.find('.Powerup.taken[data-button-data="' + bslot + '"]');
      slot.removeAttr('data-subpop-id');
      var jpowerup = _.renderView('powerup_free.html', {
        slot: bslot,
        slot_background: this.data.slot_background,
        pkey: pcat,
        data: this.popupTemplateData.data,
        typelower: convertPowerupType(pcat),
        updating: true,
      });
      var parsed = $.parseHTML(jpowerup);
      slot.addClass('updating hide');
      window.setTimeout(function () {
        slot.replaceWith(parsed);
        slot = jtab.find('.Powerup.updating[data-button-data="' + bslot + '"]');
        window.setTimeout(function () {
          slot.removeClass('updating').addClass('free');
        }, 400);
      }, 400);
      /*
        window.setTimeout(function(){
          slot = jtab.find('.Powerup.updating[data-button-data="'+bslot+'"]');
          slot.find('.PowerupBackground').delay(400).fadeOut(150,function(){
            slot.removeClass('updating').addClass('free');
          }).fadeIn(250);
        },800);
        */
    }
  };

  ProjectPerp.prototype.Charge = function () {
    var gnode = this;
    var groot = this.GameRoot;
    // Client-side pre-checks before issuing the engine call.
    if (gnode.data.charge_cost > groot.cash_value) {
      console.log(
        '[Charge] blocked: insufficient cash (have ' +
          groot.cash_value +
          ', need ' +
          gnode.data.charge_cost +
          ')'
      );
      if (gnode.renderPopup && gnode.renderPopup.open) {
        gnode.renderPopup.trigger('no_cash');
      } else {
        gnode.renderNode.FXNoCash();
      }
      return;
    }
    if (groot.ap_value < 1) {
      console.log('[Charge] blocked: insufficient AP (have ' + groot.ap_value + ')');
      gnode.NoAP();
      return;
    }
    if (!gnode.states.chargeRunning && gnode.states.idle) {
      // FIXME: rename Remote Call
      app.remote
        .chargePerp(gnode.path)
        .done(function (data) {
          if (data.result) {
            if (data.result.error !== undefined) {
              var chargeErrors = {
                1: 'insufficient AP',
                2: 'already charging',
                3: 'insufficient cash',
              };
              var chargeDetail = '';
              if (data.result.error === 1) chargeDetail = ' (AP: ' + groot.ap_value + ')';
              else if (data.result.error === 3)
                chargeDetail =
                  ' (cash: ' + groot.cash_value + ', need: ' + gnode.data.charge_cost + ')';
              console.log(
                '[Charge] failed:',
                (chargeErrors[data.result.error] || 'unknown error ' + data.result.error) +
                  chargeDetail,
                data
              );
              if (data.result.error === 3) {
                if (gnode.renderPopup && gnode.renderPopup.open) {
                  gnode.renderPopup.trigger('no_cash');
                } else {
                  gnode.renderNode.FXNoCash();
                }
              } else if (data.result.error === 1) {
                gnode.NoAP();
              }
              return;
            }
            if (gnode.renderPopup) {
              gnode.renderPopup.trigger('popup_close');
            }
            var gv = data.result.game_values;
            groot.updateGameValues(
              data.result.game_values,
              data.result.levelup,
              data.result.missions
            );

            gnode.renderNode.FXCharge();
            gnode.markTimer({
              duration: data.result.duration,
              serverTime: 0,
              serverStartTime: 0,
            });
          } else {
            // Server Error
            gnode.Error('The computer says NOOOO', data);
          }
        })
        .fail(function (data) {
          gnode.Error('The computer says NOOOO', data);
        });
    }
  };

  ProjectPerp.prototype.collect = function () {
    var gperp = this;
    var groot = this.GameRoot;
    var deco = this.renderReady;
    var popup = gperp.renderPopup;
    // No Request when no AP
    if (groot.ap_value < 1) {
      if (popup) {
        popup.trigger('no_AP');
      } else {
        deco.FXNoAP();
      }
      return;
    }
    deco.setClickable(false);
    deco.setFrame('active');
    deco.FXPulse();
    app.remote
      .collectPerp(gperp.path)
      .done(function (data) {
        // FIXME: It would be better if data.result was in a predefined state to prevent testing for both, undefined _and_ null...
        if (data.result && data.result.result) {
          var amount = data.result.result.profile_set.profiles_value;
          if (popup) {
            popup.trigger('popup_close');
          }

          groot.updateGameValues(
            data.result.game_values,
            data.result.levelup,
            data.result.missions
          );
          if (data.result.karma_incident) {
            // Karmalizer
            var karma_dec = data.result.game_values.karma_value - groot.karma_value;
            groot.makeNotifications({
              karma: {
                gestalt: data.result.karma_incident,
                karma_value: karma_dec,
              },
            });
          }
          deco.FXBling({ text: _.toKSNum(amount), extendClass: 'ProfileBling' });
          deco.FXSuck(function () {
            gperp.renderNode.FXDataOut();
            gperp.renderReady = undefined;
          });
          // Add to DB Queue
          groot
            .getDatabase()
            .cue(
              data.result.result.profile_set,
              data.result.result.origin,
              data.result.result.collect_id
            );
          gperp.setState('idle', true);
        } else if (data.result && data.result.error) {
          if (popup) {
            popup.trigger('no_AP');
          } else {
            deco.FXNoAP();
          }
          deco.FXStop();
          deco.setClickable(true);
          deco.setFrame('normal');
          //console.log('collect failed');
        } else {
          // ERROR
          gperp.Error('The computer says NOOOO', data);
        }
      })
      .fail(function (data) {
        deco.FXError();
        deco.FXStop();
        deco.setClickable(true);
        deco.setFrame('normal');
      });
  };

  ProjectPerp.prototype.markReady = function () {
    var gperp = this;
    var groot = this.GameRoot;
    gperp.setState('idle', false);
    gperp.setState('chargeRunning', false);
    if (gperp.renderTimer) {
      gperp.renderTimer.FXPuff();
    }
    var deco = (this.renderReady = this.renderNode.addDecorator(new Render.DecoratorReady()));
    deco.FXSproing();
    deco.on('vclick', function (e, renderNode) {
      e.stopPropagation();
      gperp.collect();
    });
  };

  ///////////////////////////////////
  // The Token
  ///////////////////////////////////

  var TokenPerp = function (config) {
    this.init(config);
    if (config && config.data && config.data.amount) {
      this.setAmount(config.data.amount);
    } else {
      this.setAmount(0);
    }
    return this;
  };

  extend(TokenPerp, GamePerp);

  TokenPerp.prototype.renderType = 'Perp';
  TokenPerp.prototype.cableType = 'in';
  TokenPerp.prototype.popupTemplate = 'popup_token.html';

  TokenPerp.prototype.setAmount = function (amount) {
    var groot = this.GameRoot;
    var absoluteAmount = (groot.profiles_value * amount) / 100;
    if (this.data.absoluteAmount) {
      this.data.previousAbsoluteAmount = this.data.absoluteAmount;
    } else {
      // FIXME: only true if new, not if game loaded
      this.data.previousAbsoluteAmount = 0;
    }
    this.data.absoluteAmount = absoluteAmount;
    this.amount = this.data.amount = amount;
    this.data.absoluteInc = this.data.absoluteAmount - this.data.previousAbsoluteAmount;
    this.data.absoluteIncPerc = (100 / this.data.absoluteAmount) * this.data.absoluteInc;
    groot.DBTokens[this.gestalt] = amount;
    groot.DBTokensAbsolute[this.gestalt] = absoluteAmount;
  };

  TokenPerp.prototype.updateRenderAmount = function () {
    this.renderNode.DecoratorAmount.setAmount(this.data.amount);
  };

  TokenPerp.prototype.updateGear = function () {
    if (this.data.contained_tokens.length === 0 || this.renderNode === undefined) {
      return;
    }
    this.makeProfileSet();
    var node = this.renderNode;
    var av = this.getUpgradeAverage();
    var frame = av > 0 ? 'normal' : 'inactive';
    if (!node.DecoratorGear === undefined) {
      node.addDecorator(new Render.DecoratorGear());
    }
    node.DecoratorGear.setFrame(frame);
  };

  TokenPerp.prototype.getUpgradeAverage = function () {
    this.setState('zeroresult', true);
    if (!this.data.ProfileSet) {
      return 0;
    }
    var amounts = [];
    _.each(this.data.ProfileSet.tokens_set, function (token) {
      if (!token.locked && token.diffAmount !== undefined) {
        amounts.push(token.diffAmount);
      }
    });
    var len = amounts.length || 1;
    this.data.upgradeAverage =
      Math.round(
        (_.reduce(
          amounts,
          function (memo, num) {
            return memo + num;
          },
          0
        ) /
          len) *
          100
      ) / 100;
    if (this.data.upgradeAverage > 0) {
      this.setState('zeroresult', false);
    }
    return this.data.upgradeAverage;
  };

  TokenPerp.prototype.extendRender = function () {
    var render = this.renderData || {};
    var gnode = this;
    var groot = this.GameRoot;
    var node = this.renderNode;
    node.sticky = this.sticky;

    if (render.config.label) {
      node.addDecorator(
        new Render.DecoratorLabel({
          text: render.config.label,
          extendClass: this.labelClass,
          offsetToParent: { x: 0, y: 6 },
        })
      );
    }
    var amount = this.data.amount || 0;

    node.addDecorator(new Render.DecoratorAmount({ amount: amount, decoratedNode: node }));

    if (this.data.contained_tokens && this.data.contained_tokens.length) {
      node.addDecorator(new Render.DecoratorGear());
      gnode.updateGear();
    }

    if (this._loadReady) {
      this.markReady();
      this._loadReady = undefined;
    } else if (this._loadTimer) {
      this.markTimer(this._loadTimer);
      this._loadTimer = undefined;
    }

    if (gnode.states.idle === false && gnode.data.contained_tokens.length) {
      _.each(gnode.data.contained_tokens, function (t) {
        var ct = getByGestalt(t.gestalt);
        if (ct && ct.renderNode) {
          gnode.renderNode.cableTo(ct.renderNode, {
            cableMaxLength: 1920,
            mode: 'in',
            noWobble: true,
          });
        }
      });
    }
  };

  TokenPerp.prototype.makeProfileSet = function () {
    this.data.ProfileSet = new ProfileSet(
      {
        lockNotInDB: true,
        DBAmounts: true,
        markUpgradeValues: true,
        lastUpgradeValues: this.data.last_upgrade_values,
      },
      this.data.contained_tokens
    );
  };

  TokenPerp.prototype.extendEventHandlers = function () {
    var gnode = this;

    gnode.on('vshiftclick', function (e, renderNode) {
      e.stopPropagation();
      if (gnode.data.contained_tokens.length) {
        gnode.Charge();
      }
    });

    gnode.on('vclick', function (e, renderNode) {
      e.stopPropagation();
      if (gnode.data.contained_tokens) {
        var lastUpgradeValues = gnode.data.last_upgrade_values;
        gnode.makeProfileSet();
      }
      var popup = this.openPopup();
    });

    gnode.on('node_ready', function (e, result) {
      e.stopPropagation();
      // FIXME result has no meaning here?! since A) event can be triggered by non-socket-io b) markready takes no argument.
      //gnode.markReady(result);
      //console.log('node_ready',result);
      gnode.data.last_upgrade_values = result.last_upgrade_data;
      gnode.markReady();
    });
  };

  TokenPerp.prototype.Charge = function () {
    var gnode = this;
    var rnode = this.renderNode;
    var groot = this.GameRoot;
    // No request when not enough AP
    if (groot.ap_value < 1) {
      // No AP
      if (gnode.renderPopup && gnode.renderPopup.open) {
        gnode.renderPopup.trigger('no_AP');
      } else {
        gnode.renderNode.FXNoAP();
      }
      return;
    }
    if (!gnode.states.chargeRunning && gnode.states.idle && !gnode.states.zeroresult) {
      //console.log('charge');
      app.remote
        .chargePerp(gnode.path)
        .done(function (data) {
          if (data.result) {
            if (data.result.error) {
              // No AP
              if (gnode.renderPopup && gnode.renderPopup.open) {
                gnode.renderPopup.trigger('no_AP');
              } else {
                gnode.renderNode.FXAP();
              }
              return;
            }
            if (gnode.renderPopup) {
              gnode.renderPopup.trigger('popup_close');
            }

            groot.updateGameValues(
              data.result.game_values,
              data.result.levelup,
              data.result.missions
            );
            gnode.renderNode.FXCharge('AP');

            rnode.DecoratorGear.remove();
            gnode.markTimer({
              duration: data.result.duration,
              serverTime: 0,
              serverStartTime: 0,
            });

            var wait = 300;

            _.each(gnode.data.contained_tokens, function (t) {
              var ct = getByGestalt(t.gestalt);
              if (ct && ct.renderNode) {
                window.setTimeout(function () {
                  var cable = gnode.renderNode.cableAnimatedTo(ct.renderNode, {
                    cableMaxLength: 1920,
                    mode: 'in',
                    noWobble: true,
                  });
                  window.setTimeout(function () {
                    cable.FXDataIn(function () {
                      gnode.renderNode.FXBounce();
                    });
                  }, wait + 400);
                }, wait);
                wait = wait + 150;
              }
            });
          } else {
            gnode.Error('The computer says NOOOO', data);
          }
        })
        .fail(function (data) {
          gnode.Error('The computer says NOOOO', data);
        });
    }
  };

  TokenPerp.prototype.collect = function () {
    var gperp = this;
    var groot = this.GameRoot;
    var deco = this.renderReady;
    if (groot.ap_value < 1) {
      deco.FXNoAP();
      return;
    }

    var popup = gperp.renderPopup;
    deco.setClickable(false);
    deco.setFrame('active');
    deco.FXPulse();

    app.remote
      .collectPerp(gperp.path)
      .done(function (data) {
        if (data.result && data.result.result) {
          if (popup) {
            popup.trigger('popup_close');
          }
          // FIXME: compile for checkNotifications
          groot.getDatabase().compileSuperTokens();
          var amount = data.result.result.token_upgraded_amount;
          gperp.setAmount(amount);
          groot.updateGameValues(
            data.result.game_values,
            data.result.levelup,
            data.result.missions
          );
          //deco.FXBling({text: _.toKSNum(gperp.data.absoluteIncPerc) + "%", extendClass: "ProfileBling"});
          deco.FXSuck(function () {
            //gperp.renderNode.DecoratorGear.show();
            gperp.renderNode.addDecorator(new Render.DecoratorGear());
            gperp.updateGear();
            gperp.renderNode.DecoratorGear.FXSproing();
            gperp.renderReady = undefined;
            window.setTimeout(function () {
              groot.getDatabase().checkNotifications();
              groot.updateGears();
            }, 2000);
          });
          var wait = 0;

          /* 
          //FX WITHOUT CABLES 
          _.each(gperp.data.contained_tokens,function(t){
            var ct = getByGestalt(t.gestalt);
            if (ct && ct.renderNode) {
              window.setTimeout(function(){gperp.renderNode.FXSpark({oPos:ct.renderNode.getPosition(),text: 'snu'})},wait);
              wait = wait+200;
            }
          });
          */

          // FX WITH CABLES
          _.each(gperp.data.contained_tokens, function (t) {
            var ct = getByGestalt(t.gestalt);
            if (ct && ct.renderNode) {
              //window.setTimeout(function(){
              //ct.renderNode.FXDataOut();
              window.setTimeout(function () {
                gperp.renderNode.cableAnimatedRemove(ct.renderNode);
              }, wait + 200);
              //},wait);
              wait = wait + 200;
            }
          });
          // FIXME when previous was 0 there's something wrong here...
          //var text = "+" + _.toKSNum(gperp.data.absoluteIncPerc) + "%";
          var text = '+' + _.toKSNum(gperp.data.absoluteInc);
          window.setTimeout(function () {
            gperp.renderNode.FXSpinner({ text: text, duration: wait }, function () {
              gperp.updateRenderAmount();
              //gperp.renderNode.DecoratorAmount.setAmount(gperp.data.amount);
            });
          }, 800);
          // FIXME Merge to DB

          gperp.setState('idle', true);
        } else if (data.result && data.result.error) {
          deco.FXNoAP();
          deco.FXStop();
          deco.setClickable(true);
          deco.setFrame('normal');
          //console.log('collect failed');
        } else {
          // ERROR
          gperp.Error('The computer says NOOOO', data);
        }
      })
      .fail(function (data) {
        deco.FXError();
        deco.FXStop();
        deco.setClickable(true);
        deco.setFrame('normal');
      });
  };

  TokenPerp.prototype.markReady = function () {
    var gperp = this;
    var groot = this.GameRoot;
    gperp.setState('idle', false);
    gperp.setState('chargeRunning', false);
    if (gperp.renderTimer) {
      gperp.renderTimer.FXPuff();
    }
    var deco = (this.renderReady = this.renderNode.addDecorator(
      new Render.DecoratorReady({ mode: 'gear' })
    ));
    deco.FXSproing();
    deco.on('vclick', function (e, renderNode) {
      e.stopPropagation();
      gperp.collect();
    });
  };

  ///////////////////////////////////
  // The Supertoken
  ///////////////////////////////////

  var SupertokenPerp = function (config) {
    this.init(config);
    return this;
  };

  extend(SupertokenPerp, GamePerp);

  SupertokenPerp.prototype.renderType = 'Perp';
  TokenPerp.prototype.cableType = 'inout';

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

  // Register every published class with the perpRegistry so
  // scripts/game/Database.ts (and future-extracted subclasses) can
  // resolve dynamic `Game[node.game_type]` lookups + direct
  // `Game.TokenPerp` references without an IIFE-closure roundtrip.
  // Disposable seam — retired with the IIFE in the final PR (#147).
  setPerpClasses(Game);
  // Inject AniTicker into GamePerp so its initEventHandlers can register
  // listeners on the legacy ticker singleton (which still lives in this
  // IIFE). Disposable seam alongside setPerpClasses; retires when AniTicker
  // is itself extracted from Game.js.
  setAniTicker(AniTicker);

  return Game;
};

var game;

export function getGame() {
  game = game || Game();
  return game;
}

export default { getGame };
