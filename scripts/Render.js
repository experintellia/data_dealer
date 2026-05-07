// @ts-nocheck — strict-TS quarantine; remove when this file is migrated to TS (issue #147)
// Vendor libs (window.Scroller, window.core, window.createjs) are read
// off globalThis at factory-body time on the first getRender() call,
// so this module is safe to bundle alongside code that runs before
// the vendor `<script>` tags execute.
import appModule from './app.js';
import { RenderButtonInline as RenderButtonInlineClass } from './render/RenderButtonInline.js';
import {
  RenderCable as RenderCableClass,
  RenderPerpCable as RenderPerpCableClass,
  setRenderCableResolution,
} from './render/RenderCables.js';
import { RenderCircle as RenderCircleClass } from './render/RenderCircle.js';
import {
  RenderDecoratorAmount as RenderDecoratorAmountClass,
  RenderDecorator as RenderDecoratorClass,
  RenderDecoratorGear as RenderDecoratorGearClass,
  RenderDecoratorLabel as RenderDecoratorLabelClass,
  RenderDecoratorNew as RenderDecoratorNewClass,
  RenderDecoratorReady as RenderDecoratorReadyClass,
  RenderDecoratorTimer as RenderDecoratorTimerClass,
  setRenderDecoratorSlowTicker,
} from './render/RenderDecorators.js';
import { RenderDragHandler } from './render/RenderDragHandler.js';
import { RenderNode, setRenderNodeRegistry, setRenderNodeTickers } from './render/RenderNode.js';
import { applyRenderNodeFX } from './render/RenderNodeFX.js';
import { RenderPerp as RenderPerpClass } from './render/RenderPerp.js';
import { RenderPerpSprite as RenderPerpSpriteClass } from './render/RenderPerpSprite.js';
import { RenderSet } from './render/RenderSet.js';
import { RenderSprite as RenderSpriteClass } from './render/RenderSprite.js';
import { RenderText as RenderTextClass } from './render/RenderText.js';
import {
  RenderMainMenu as RenderMainMenuClass,
  RenderStage as RenderStageClass,
  RenderViewMap as RenderViewMapClass,
  RenderViewTab as RenderViewTabClass,
  setRenderViewsConfig,
} from './render/RenderViews.js';
import { renderSpriteHtml } from './render/renderSpriteHelper.js';
import setup from './setup.js';
import utilDefault from './util.js';

var Render = function () {
  var _ = globalThis._;
  var $ = globalThis.jQuery || globalThis.$;

  var Scroller = globalThis.Scroller;
  var core = globalThis.core;

  // Tween is the sub-class; Easel and Sound just alias the namespace.
  var Easel = globalThis.createjs;
  var Tween = globalThis.createjs.Tween;
  var Sound = globalThis.createjs;
  var Ticker = Easel.Ticker;
  var Ease = Easel.Ease;

  // Shim CreateJS legacy Ticker.{addListener,removeListener,setFPS} onto
  // the current EventDispatcher API so Render's tick-object callers work.
  if (typeof Ticker.addListener !== 'function') {
    var _tickHandlers = new WeakMap();
    Ticker.addListener = function (obj) {
      if (_tickHandlers.has(obj)) {
        return;
      }
      var fn = function () {
        if (typeof obj.tick === 'function') {
          obj.tick();
        }
      };
      _tickHandlers.set(obj, fn);
      Ticker.addEventListener('tick', fn);
    };
    Ticker.removeListener = function (obj) {
      var fn = _tickHandlers.get(obj);
      if (fn) {
        Ticker.removeEventListener('tick', fn);
        _tickHandlers.delete(obj);
      }
    };
  }
  // Always override setFPS so we use the modern `framerate=` setter even
  // when the legacy method still exists (it logs a deprecation warning
  // on every call in current TweenJS builds).
  Ticker.setFPS = function (fps) {
    Ticker.framerate = fps;
  };

  var app = appModule.getApplication();
  var extend = utilDefault.extend;

  var renderConf = {
    cableResolution: 2,
    tickerFramerate: 60,
    slowTickerFrameRate: 120,
    viewMapPerspective: setup.viewMapPerspective,
    viewMapStopZone: setup.viewMapStopZone,
  };

  Ticker.setFPS(renderConf.tickerFramerate);
  Ticker.useRAF = true;

  //////////////////////////////////////////
  //
  // The Render API
  //
  // Instantiates a tree like structure of
  // render nodes, feeds events back to
  // Game controller if available.
  // Uses mostly jQuery and Vanilla-JS to
  // manipulate the DOM
  //
  // Here be dragons and sea serpents...
  //
  //////////////////////////////////////////

  /////////////////////////////////////////////
  // Some generic tools and getter functions
  /////////////////////////////////////////////

  var _instances = [];
  var _ids = {};

  var add = function (node) {
    _instances[node._id] = node;
    _ids[node.id] = node;
  };

  var get = function (_id) {
    return _instances[_id];
  };

  var getById = function (id) {
    return _ids[id];
  };

  var remove = function (_id) {
    if (get(_id)) {
      delete _ids[get(_id).id];
    }
    _instances[_id] = undefined;
  };

  var clear = function () {
    // Clear everything that has been rendered so far
    for (var n = 0; n < _instances.length; n++) {
      var node = _instances[n];
      if (node) {
        node.remove();
      }
    }
    _instances.length = 0;
  };

  /////////////////////////////////////////////
  // The Draghandler
  /////////////////////////////////////////////
  //
  // Extracted to scripts/render/RenderDragHandler.ts in PR 30 of issue
  // #147.  Imported as `RenderDragHandler`, aliased back to `DragHandler`
  // here so the existing `new DragHandler()` call sites inside this IIFE
  // keep working unchanged.

  var DragHandler = RenderDragHandler;

  ///////////////////////////////////////////
  // The Set
  ///////////////////////////////////////////
  //
  // Extracted to scripts/render/RenderSet.ts in PR 29 of issue #147.
  // Imported as `RenderSet`, aliased back to `Set` here so the
  // existing `new Set()` call sites inside this IIFE keep working
  // unchanged.  RenderSet extends scripts/game/OrderedSet.ts so the
  // common collection surface is no longer duplicated.
  // biome-ignore lint/suspicious/noShadowRestrictedNames: legacy collection class predates ES6 Set
  var Set = RenderSet;

  /////////////////////////////////////////////
  // The SlowTicker
  /////////////////////////////////////////////

  // Written as Singleton, like original Ticker

  var SlowTicker = {
    start: function () {
      if (!this.timeout) {
        this.tick();
      }
    },
    tick: function () {
      this.listeners.each(function (node) {
        node.tick();
      });
      this.timeout = window.setTimeout(function () {
        SlowTicker.tick();
      }, renderConf.slowTickerFrameRate);
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
  SlowTicker.listeners = new Set();
  SlowTicker.start();

  // Wire the SlowTicker seam used by RenderDecoratorTimer (PR 36 of
  // issue #147).
  setRenderDecoratorSlowTicker(SlowTicker);

  /////////////////////////////
  // The Node
  // Basic Render Node with DOM Element
  /////////////////////////////
  //
  // Extracted to scripts/render/RenderNode.ts in PR 31 of issue #147.
  // Imported as `RenderNode`, aliased back to `Node` here so the
  // existing in-IIFE call sites (`extend(Sprite, Node)`,
  // `Node.prototype.FXX = …`, `new Node(…)`) keep working unchanged.
  //
  // RenderNode is decoupled from this IIFE's state via two seams:
  //   - `setRenderNodeRegistry` wires up the `_instances` / `_ids`
  //     registers that live in this file's outer scope.
  //   - `setRenderNodeTickers` wires up `Ticker` and `SlowTicker` so
  //     `RenderNode#remove()` can unregister from both.
  // Both seams must be wired before any `new Node(…)` runs, which is
  // why we set them up immediately after the alias.
  //
  // The FX/animation methods (FXSimple … FXElasticTo) below stay in
  // this file for now — they construct Sprite/Text instances which
  // themselves extend Node, so moving them needs constructor seams
  // for every visual primitive.  They mutate `RenderNode.prototype`
  // through the alias, so subclass instances pick them up via the
  // prototype chain just like with the legacy class.

  var Node = RenderNode;

  setRenderNodeRegistry({
    count: function () {
      return _instances.length;
    },
    add: add,
    remove: remove,
  });

  setRenderNodeTickers({
    tickerRemove: function (node) {
      Ticker.removeListener(node);
    },
    slowTickerRemove: function (node) {
      SlowTicker.removeListener(node);
    },
  });

  ////////////////////
  // Node FX
  ////////////////////
  //
  // Extracted to scripts/render/RenderNodeFX.ts in PR 33 of issue #147.
  // The FX/animation methods (FXSimple … FXElasticTo) are applied as
  // a mixin onto RenderNode.prototype here, after the CreateJS Ticker
  // / Tween / Ease vendor globals have been resolved at the top of
  // this factory.  Subclass instances pick the methods up via the
  // prototype chain just like with the legacy assignment block.

  applyRenderNodeFX({ Ticker: Ticker, Tween: Tween, Ease: Ease });

  /////////////////////////////
  // The Circle
  /////////////////////////////
  //
  // Extracted to scripts/render/RenderCircle.ts in PR 34 of issue
  // #147.  Imported as `RenderCircleClass` and aliased back to
  // `Circle` so the publisher entry and any external consumer keeps
  // working unchanged.

  var Circle = RenderCircleClass;

  /////////////////////////////
  // The Text
  /////////////////////////////
  //
  // Extracted to scripts/render/RenderText.ts in PR 32 of issue #147.
  // Imported as `RenderTextClass` and aliased back to `Text` so the
  // existing in-IIFE call sites (`new Text(...)` in FXBling /
  // FXBlingQueue, the publisher entry) keep working unchanged.

  var Text = RenderTextClass;

  /////////////////////////////
  // The Sprite
  /////////////////////////////
  //
  // Extracted to scripts/render/RenderSprite.ts in PR 32 of issue #147.
  // Imported as `RenderSpriteClass` (not `RenderSprite`) because this
  // IIFE already owns a legacy `var RenderSprite = function(...)`
  // helper further down — `var` hoisting would otherwise shadow the
  // imported binding and leave `Sprite` resolving to `undefined`,
  // which detonates the first `extend(Perp, Sprite)` call.  Aliased
  // back to `Sprite` so the in-IIFE call sites (`new Sprite(...)`
  // in many FX methods, `extend(Perp, Sprite)`, `extend(PerpSprite,
  // Sprite)`, the publisher entry) keep working unchanged.

  var Sprite = RenderSpriteClass;

  /////////////////////////////
  // The Perp
  /////////////////////////////
  //
  // Extracted to scripts/render/RenderPerp.ts in PR 35 of issue
  // #147.  Aliased back to `Perp` so existing in-IIFE call sites
  // and the publisher entry keep working unchanged.  PR 37
  // retired the `setPerpCableCtor` seam — RenderPerp.cableTo
  // imports `RenderPerpCable` directly now.

  var Perp = RenderPerpClass;

  /////////////////////////////
  // The PerpSprite
  /////////////////////////////
  //
  // Extracted to scripts/render/RenderPerpSprite.ts in PR 35 of
  // issue #147.  Aliased back to `PerpSprite` so the publisher
  // entry keeps working unchanged.

  var PerpSprite = RenderPerpSpriteClass;

  /////////////////////////////
  // The Decorator family
  /////////////////////////////
  //
  // Extracted to scripts/render/RenderDecorators.ts in PR 36 of
  // issue #147.  Aliased back to their legacy names so the
  // publisher entries and any external consumer keeps working
  // unchanged.  The DecoratorTimer SlowTicker seam was wired
  // immediately after SlowTicker.start() above.

  var Decorator = RenderDecoratorClass;
  var DecoratorReady = RenderDecoratorReadyClass;
  var DecoratorLabel = RenderDecoratorLabelClass;
  var DecoratorNew = RenderDecoratorNewClass;
  var DecoratorGear = RenderDecoratorGearClass;
  var DecoratorTimer = RenderDecoratorTimerClass;
  var DecoratorAmount = RenderDecoratorAmountClass;

  /////////////////////////////
  // The Cable + PerpCable
  /////////////////////////////
  //
  // Extracted to scripts/render/RenderCables.ts in PR 37 of issue
  // #147.  Aliased back to `Cable` / `PerpCable` so the publisher
  // entries and any external consumer keeps working unchanged.
  // The `setPerpCableCtor` seam from PR #220 is now retired —
  // RenderPerp.cableTo imports RenderPerpCable directly.

  setRenderCableResolution(renderConf.cableResolution);

  var Cable = RenderCableClass;
  var PerpCable = RenderPerpCableClass;

  /////////////////////////////
  // The Views (ViewTab + ViewMap + Stage + MainMenu)
  /////////////////////////////
  //
  // Extracted to scripts/render/RenderViews.ts in PR 38 of issue
  // #147.  Aliased back to their legacy names so the publisher
  // entries and any external consumer keeps working unchanged.
  // The viewMapStopZone clip configured on `renderConf` flows in
  // via `setRenderViewsConfig`, wired below.

  setRenderViewsConfig({ viewMapStopZone: renderConf.viewMapStopZone });

  var ViewTab = RenderViewTabClass;
  var ViewMap = RenderViewMapClass;
  var Stage = RenderStageClass;
  var MainMenu = RenderMainMenuClass;

  /////////////////////////////
  //       The ButtonInline
  /////////////////////////////

  // FIXME: Find a better way to implement Buttons, Menus
  // and all that stuff that doesn't actually need generic RenderNode stuff
  //
  // Extracted to scripts/render/RenderButtonInline.ts in PR 34 of
  // issue #147.  Imported as `RenderButtonInlineClass` and aliased
  // back to `ButtonInline` so the publisher entry and any external
  // consumer keeps working unchanged.

  var ButtonInline = RenderButtonInlineClass;

  /////////////////////////////
  //       The Statusbar
  /////////////////////////////

  var Statusbar = function (config) {
    config = config || {};
    this._id = _instances.length;
    this.jdomelem = $("<div class='Statusbar'></div>");
    this.domelem = this.jdomelem[0];

    this.init(config);

    this.profiles_val = this.profiles.val;
    this.profiles_max = this.profiles.max;
    this.profiles_barsize = this.profiles.barsize;
    this.profiles_crosssum = this.profiles.crosssum;
    this.profiles_tokenslength = this.profiles.tokenslength;
    this.profiles_tokenslengthmax = this.profiles.tokenslengthmax;
    this.cash_val = this.cash.val;
    this.AP_val = this.AP.val;
    this.AP_max = this.AP.max;
    this.AP_barsize = this.AP.barsize;
    this.karma_val = this.karma.val;
    this.karma_max = this.karma.max;
    this.karma_intensity = this.karma_intensity;
    this.karma_barsize = this.karma.barsize;
    this.XP_val = this.XP.val;
    this.XP_max = this.XP.max;
    this.XP_level = this.XP.level;
    this.XP_barsize = this.XP.barsize;

    this.initUI();

    // FIXME: data should be referenced to serverdata
  };
  extend(Statusbar, Node);

  Statusbar.prototype.onAddInit = function () {
    this.updateRenderProp();
    this.render();
  };

  Statusbar.prototype.draw = function () {
    // Update domelem to current settings
    this.setSize(this.getSize());
    this.setTransform(this.getTransform());
    this.setPosition(this.getPosition());
    this.setOpacity(this.opacity);
  };

  Statusbar.prototype.template = 'statusbar.html';
  Statusbar.prototype.width = 720;
  Statusbar.prototype.height = 25;
  Statusbar.prototype.y = 12;
  Statusbar.prototype.z = 10000;
  Statusbar.prototype.offsetX = Statusbar.prototype.width / 2;
  Statusbar.prototype.offsetY = 0;

  Statusbar.prototype.render = function () {
    this.x = this.parentNode.getSize().width / 2;
    this.jdomelem.empty();
    var html = app.renderView(this.template, this);
    this.jdomelem.append(html);
    this.draw();

    // Mirror to the MainMenu's mobile XP slot (CSS hides it on desktop).
    var groot = this.gameNode && this.gameNode.GameRoot;
    if (groot && groot.renderMenu && groot.renderMenu.renderXP) {
      groot.renderMenu.renderXP(this);
    }
  };

  Statusbar.prototype.tick = function () {
    this.render();
  };

  // Silent paths bypass the Tween machinery: we just assign the flat
  // template props and re-render once. FXSimpleCue with dur=0 still
  // queues a Ticker listener and chains onto any active tween, so
  // letting silent updateGameValues run through it would grow the
  // tween queue under bursty silent traffic.
  Statusbar.prototype.FXUpdateAP = function (silent) {
    this.AP_val = this.AP.val;
    if (silent) {
      this.AP_active = 0;
      this.AP_max = this.AP.max;
      this.AP_barsize = this.AP.barsize;
      this.render();
      return;
    }
    this.AP_active = 1;
    this.FXSimpleCue(
      { AP_active: 0, AP_max: this.AP.max, AP_barsize: this.AP.barsize },
      250,
      'linear'
    );
  };
  Statusbar.prototype.FXUpdateXP = function (silent) {
    this.XP_level = this.XP.level;
    this.XP_val = this.XP.val;
    if (silent) {
      this.XP_active = 0;
      this.XP_barsize = this.XP.barsize;
      this.render();
      return;
    }
    this.XP_active = 1;
    this.FXSimpleCue({ XP_active: 0, XP_barsize: this.XP.barsize }, 250, 'linear');
  };
  Statusbar.prototype.FXUpdateCash = function (silent) {
    if (silent) {
      this.cash_active = 0;
      this.cash_val = this.cash.val;
      this.render();
      return;
    }
    this.cash_active = 1;
    this.FXSimpleCue({ cash_active: 0, cash_val: this.cash.val }, 250, 'linear');
  };
  Statusbar.prototype.FXUpdateKarma = function (silent) {
    if (silent) {
      this.karma_active = 0;
      this.karma_val = this.karma.val;
      this.karma_barsize = this.karma.barsize;
      this.render();
      return;
    }
    this.karma_active = 1;
    this.FXSimpleCue(
      { karma_active: 0, karma_val: this.karma.val, karma_barsize: this.karma.barsize },
      250,
      'linear'
    );
  };
  Statusbar.prototype.FXUpdateProfiles = function (silent) {
    if (silent) {
      this.profiles_active = 0;
      this.profiles_val = this.profiles.val;
      this.profiles_barsize = this.profiles.barsize;
      this.profiles_crosssum = this.profiles.crosssum;
      this.profiles_tokenslength = this.profiles.tokenslength;
      this.render();
      return;
    }
    this.profiles_active = 1;
    this.FXSimpleCue(
      {
        profiles_active: 0,
        profiles_val: this.profiles.val,
        profiles_barsize: this.profiles.barsize,
        profiles_crosssum: this.profiles.crosssum,
        profiles_tokenslength: this.profiles.tokenslength,
      },
      500,
      'linear'
    );
  };

  Statusbar.prototype.startLoop = function (func, time) {
    var node = this;
    // only one loop per node
    time = time || 1000;
    if (this.loop) {
      window.clearTimeout(this.loop);
    }
    if (func) {
      func();
    }
    this.loop = window.setTimeout(function () {
      node.startLoop(func, time);
    }, time);
  };

  Statusbar.prototype.stopLoop = function () {
    if (this.loop) {
      window.clearTimeout(this.loop);
    }
  };

  Statusbar.prototype.textMoreIn = _._('More Energy in') + ' ';
  Statusbar.prototype.initUI = function () {
    var node = this;
    node.jdomelem.on('click touchend', '.StatusItem', function (e) {
      e.stopPropagation();
      var statusid = $(this).attr('data-status-id');
      node.trigger('click_status.' + statusid);
    });

    node.jdomelem.on('mouseenter', '.StatusItem.AP', function (e) {
      e.stopPropagation();
      var groot = node.gameNode.GameRoot;
      if (groot.ap_value >= groot.xp_level.ap_max) {
        return;
      }
      var jtext = $(this).find('.StatusRemain');
      jtext.show();
      var APT = groot.APTicker;
      node.startLoop(function () {
        jtext.html(node.textMoreIn + _.span(_.toTime(APT.getRemainingTime())));
      }, 1000);
    });
    node.jdomelem.on('mouseleave', '.StatusItem.AP', function (e) {
      e.stopPropagation();
      node.stopLoop();
      var jtext = $(this).find('.StatusRemain');
      jtext.hide();
    });
  };

  /////////////////////////////
  //       The Status
  /////////////////////////////

  var StatusItem = function (config) {
    config = config || {};
    this._id = _instances.length;
    this.jdomelem = $("<div class='StatusItem'></div>");
    this.frameSrc = config.frameSrc || 'MainSprites.png';
    this.frameMap = config.frameMap || {
      normal: { x: 36, y: 580, width: 128, height: 25, pivotx: 0, pivoty: 0 },
    };
    this.frame = 'normal';
    this.domelem = this.jdomelem[0];
    this.init(config);
    this.setFrameSrc(this.frameSrc);
    this.setFrame(this.frame);
    this.draw();
  };
  extend(StatusItem, Sprite);

  /////////////////////////////
  //       The DatabaseQueue
  /////////////////////////////

  var DBQueue = function (config) {
    config = config || {};
    var node = this;
    this._id = _instances.length;
    this.jdomelem = $("<div class='DatabaseQueue'></div>");
    this.domelem = this.jdomelem[0];

    this.init(config);
    this.off();

    this.jdomelem.on(
      'click touchend',
      '.Button:not(.disabled)[data-button-id="DatabaseUpgrades"]',
      function (e) {
        e.stopPropagation();
        e.preventDefault();
        node.trigger('select_upgrades');
      }
    );
    this.jdomelem.on('click touchend', '.DatabaseQueueItem:not(.disabled)', function (e) {
      e.stopPropagation();
      e.preventDefault();
      // TODO get real ID, currently needs integer...
      var psid = $(this).attr('data-psid');
      node.jdomelem.find('.DatabaseQueueItem').removeClass('selected');
      $(this).addClass('selected');

      if (e.shiftKey) {
        node.trigger('profileset_shift_click', [psid]);
      } else {
        node.trigger('profileset_click', [psid]);
      }
    });

    node.on('mousedown touchstart', function (e) {
      var userPos = {};
      userPos.x = e.pageX - node.jdomelem.offset().left;
      userPos.y = e.pageY - node.jdomelem.offset().top;
      node.userClickAbsPos = userPos;
    });
  };
  extend(DBQueue, Node);

  DBQueue.prototype.onAddInit = function () {
    this.updateRenderProp();
    this.render();
  };

  DBQueue.prototype.textProfilesNew = _._('%s New');
  DBQueue.prototype.textUpdated = _._('%s Updated');
  DBQueue.prototype.FXMerge = function (psid, inc, dup, wait) {
    var ps = this.jdomelem.find('.DatabaseQueueItem[data-psid=' + psid + ']');
    var after = ps.nextAll('.DatabaseQueueItem');
    ps.addClass('disabled');
    this.FXBlingQueue({
      text: _.sprintf(this.textProfilesNew, _.toKSNum(inc)),
      wait: 200,
      extendClass: 'ProfileBlingNew',
    });
    this.FXBlingQueue({
      text: _.sprintf(this.textUpdated, _.toKSNum(dup)),
      wait: 500,
      extendClass: 'ProfileBlingUpdated',
    });
    window.setTimeout(function () {
      ps.addClass('merging');
    }, 200);
    // FIXME: BROKEN ANI

    window.setTimeout(function () {
      ps.animate({ top: '102' }, 250, function () {
        var del = 0;
        after.each(function () {
          $(this).animate({ left: '-=100' }, 250 + del);
          del += 50;
        });
        ps.remove();
      });
    }, 2000 + wait);
    /*
      ps.delay(500 + wait).animate({top: '102'}, 250, function(){
        after.each(function(){
          $(this).animate({left:"-=100"},500);
        });
        ps.remove();
      });
      */
    /*
      ps.delay(2500+wait).animate({top: '100'}, 250, function() {
        ps.remove()
      });
      */

    //window.setTimeout(function(){ps.remove();},1000)
  };

  DBQueue.prototype.draw = function () {
    // Update domelem to current settings
    this.setSize(this.getSize());
    this.setTransform(this.getTransform());
    this.setPosition(this.getPosition());
    this.setOpacity(this.opacity);
  };

  DBQueue.prototype.template = 'db_queue.html';
  DBQueue.prototype.width = 720;
  DBQueue.prototype.height = 100;
  DBQueue.prototype.z = 10;
  DBQueue.prototype.offsetX = DBQueue.prototype.width / 2;
  DBQueue.prototype.offsetY = -58;

  DBQueue.prototype.render = function () {
    this.x = this.parentNode.parentNode.getSize().width / 2;
    this.y = this.parentNode.parentNode.getSize().height - this.height;
    this.jdomelem.empty();
    var html = app.renderView(this.template, this);
    this.jdomelem.append(html);
    this.draw();
  };

  DBQueue.prototype.tick = function () {
    this.render();
  };

  /////////////////////////////
  //       The Popup
  /////////////////////////////

  var Popup = function Popup(config) {
    config = config || {};

    this.open = true;
    this._id = _instances.length;
    this.jdomelem = $("<div class='Popup'></div>");
    this.domelem = this.jdomelem[0];
    this.init(config);
    this.initBaseUI();
  };
  extend(Popup, Node);

  Popup.prototype.template = 'popup.html';
  Popup.prototype.width = 600;
  //Popup.prototype.height = 520;
  Popup.prototype.offsetX = Popup.prototype.width / 2;
  Popup.prototype.offsetY = Popup.prototype.height / 2 - 10;

  Popup.prototype.initBaseUI = function () {
    var node = this;
    var tdata = this.templateData;
    // Render sprites only if not instantiated yet
    if (tdata.data && tdata.data.popup_sprite && !tdata.data.popup_sprite.html) {
      tdata.data.popup_sprite.html = RenderSprite(tdata.data.popup_sprite);
    }
    // biome-ignore lint/correctness/noSelfAssign: legacy no-op, kept to avoid accidental removal of the property
    tdata.button = tdata.button;

    if (this.popupContainer && this.extendClass) {
      this.popupContainer.renderNode.popupContainerDomelem.addClass(this.extendClass);
    }

    node.render();

    node.jdomelem.on('click touchend', function (e) {
      e.stopPropagation();
      e.preventDefault();
    });

    if (this.popupContainer) {
      this.popupContainer.lock();
      this.popupContainer.renderNode.popupContainerDomelem.on('click touchend', function (e) {
        if (!$(this).hasClass('NoClose')) {
          node.trigger('popup_close');
          node.trigger('popup_cancel');
        }
      });
    }

    node.on('no_cash', function (e) {
      if (node.lastButton) {
        node.jdomelem.find('.Button').removeClass('disabled no_cash');
        node.lastButton.addClass('disabled no_cash');
      } else {
        node.jdomelem.find('.Button.MainButton').addClass('disabled no_cash').removeClass('active');
      }
      node.FXNoCash();
    });

    node.on('no_AP', function (e) {
      if (node.lastButton) {
        node.jdomelem.find('.Button').removeClass('disabled no_AP');
        node.lastButton.addClass('disabled no_AP');
      } else {
        node.jdomelem.find('.Button.MainButton').addClass('disabled no_AP').removeClass('active');
      }
      node.FXNoAP();
    });

    node.on('error', function (e) {
      if (node.lastButton) {
        node.jdomelem.find('.Button').removeClass('active disabled ERROR');
        node.lastButton.addClass('disabled ERROR');
      } else {
        node.jdomelem.find('.Button.MainButton').addClass('disabled ERROR').removeClass('active');
      }
      node.FXError();
    });

    node.jdomelem.on('click touchend', '.PopupLogo', function (e) {
      // FIXME: put debug flag here!
      if (setup.debug) {
        node.jdomelem.find('.Debug').toggle();
        console.log(node.gameNode);
      }
    });

    node.jdomelem.on('click touchend', '.Button:not(.disabled, .active)', function (e) {
      e.stopPropagation();
      e.preventDefault();
      var button = $(this);
      var bgestalt = button.attr('data-button-gestalt');
      //var bslot = button.attr('data-slot-id');
      var bdata = button.attr('data-button-data');
      node.lastButton = button;
      button.addClass('active');
      node.trigger('button_click.' + button.attr('data-button-id'), [bgestalt, bdata]);
    });

    node.jdomelem.on('click touchend', '.Button.no_cash', function (e) {
      e.stopPropagation();
      e.preventDefault();
      node.FXNoCash();
    });

    node.jdomelem.on('click touchend', '.Button.no_AP', function (e) {
      e.stopPropagation();
      e.preventDefault();
      node.FXNoAP();
    });

    node.jdomelem.on('click touchend', '.PopupClose', function (e) {
      e.stopPropagation();
      e.preventDefault();
      node.trigger('popup_close');
      node.trigger('popup_cancel');
    });

    // Tutorial dialogs advance on tap anywhere (body or backdrop).
    // tutorialTouchFired guards against the synthesized click that some
    // browsers emit after touchend even when preventDefault() is called.
    if (node.extendClass === 'Tutorial') {
      var tutorialTouchFired = false;
      var advanceTutorial = function (e) {
        if (e.type === 'touchend') {
          tutorialTouchFired = true;
        } else if (tutorialTouchFired) {
          tutorialTouchFired = false;
          return;
        }
        e.stopPropagation();
        e.preventDefault();
        node.trigger('popup_close');
      };
      node.jdomelem.on('touchend click', '.TutorialBody', advanceTutorial);
      if (this.popupContainer) {
        var $tutorialContainer = this.popupContainer.renderNode.popupContainerDomelem;
        $tutorialContainer.on('touchend click', advanceTutorial);
        // Each tutorial step creates a new Popup and calls initEvents, so
        // without cleanup advanceTutorial accumulates on the persistent
        // container element (Popup.close never calls .off on it).
        node.on('popup_close', function () {
          $tutorialContainer.off('touchend click', advanceTutorial);
        });
      }
    }

    node.jdomelem.on(
      'click touchend',
      '.Subpop[data-subpop-id="buyslots"] .BuySlotsInc',
      function (e) {
        e.stopPropagation();
        e.preventDefault();
        var spop = $(this).parents('.Subpop[data-subpop-id="buyslots"]');
        var button = spop.find('.Button[data-button-id="PowerupBuySlotsButton"]');
        var num = Number.parseInt(button.attr('data-button-data'));
        var left = Number.parseInt(spop.find('.BuySlotsNumLeft').text());
        var jprice = spop.find('.SlotCost');
        var price = Number.parseInt(jprice.attr('data-slot-cost'));
        var max_slots = left;
        num = num + 1 > max_slots ? num : num + 1;
        price = price * num;
        jprice.text(_.toKSNum(price));
        spop.find('.BuySlotsNum').text(num);
        spop.find('.BuySlotsNum').text(num);
        button.attr('data-button-data', num);
      }
    );

    node.jdomelem.on(
      'click touchend',
      '.Subpop[data-subpop-id="buyslots"] .BuySlotsDec',
      function (e) {
        e.stopPropagation();
        e.preventDefault();
        var spop = $(this).parents('.Subpop[data-subpop-id="buyslots"]');
        var button = spop.find('.Button[data-button-id="PowerupBuySlotsButton"]');
        var num = Number.parseInt(button.attr('data-button-data'));
        var jprice = spop.find('.SlotCost');
        var price = Number.parseInt(jprice.attr('data-slot-cost'));
        num = num - 1 < 1 ? 1 : num - 1;
        price = price * num;
        jprice.text(_.toKSNum(price));
        spop.find('.BuySlotsNum').text(num);
        button.attr('data-button-data', num);
      }
    );

    node.jdomelem.on('click touchend', '.PopupMenu .PopupMenuButton', function (e) {
      e.stopPropagation();
      e.preventDefault();
      var mbutton = $(this);
      node.jdomelem.find('.PopupMenuButton').removeClass('active');
      mbutton.addClass('active');
      if (mbutton.hasClass('TabArrowNew')) {
        mbutton.removeClass('TabArrowNew');
      }
      node.jdomelem.find('.PopupTab').hide();
      node.jdomelem.find('.PopupTab[data-tab="' + mbutton.attr('data-tab') + '"]').show();
      node.jdomelem.find('.PopupText.TabText').hide();
      node.jdomelem.find('.PopupText.TabText[data-tab="' + mbutton.attr('data-tab') + '"]').show();
      node.templateData.lastTab = mbutton.attr('data-tab');
    });

    node.jdomelem.on('click touchend', '.Powerup:not(.updating, .locked)', function (e) {
      e.stopPropagation();
      e.preventDefault();
      var powerup = $(this);
      var subpopid = powerup.attr('data-subpop-id');
      var slotid = powerup.attr('data-button-data');
      var container = powerup.parents('.PopupTab').find('.SubpopContainer');
      powerup.parents('.PopupTab').addClass('hasPopup');
      container.addClass('open');
      container.find('.Selector.open').addClass('hasPopup');
      container.find('.Subpop[data-subpop-id=' + subpopid + ']').addClass('open');
      container
        .find('.Subpop[data-subpop-id=' + subpopid + ']')
        .find('.Powerup, .Button')
        .attr('data-button-data', slotid);
    });

    node.jdomelem.on('click touchend', '.PopupPerp:not(.locked)', function (e) {
      e.stopPropagation();
      e.preventDefault();
      var perp = $(this);
      var subpopid = perp.attr('data-subpop-id');
      var container = perp.parents('.PopupTab').find('.SubpopContainer');
      perp.parents('.PopupTab').addClass('hasPopup');
      container.addClass('open');
      container.find('.Selector.open').addClass('hasPopup');
      container.find('.Subpop[data-subpop-id=' + subpopid + ']').addClass('open');
    });

    node.jdomelem.on('click touchend', '.PopupToken:not(.locked)', function (e) {
      e.stopPropagation();
      e.preventDefault();
      var token = $(this);
      var subpopid = token.attr('data-subpop-id');
      var container = token.parents('.PopupTab').find('.SubpopContainer');
      token.parents('.PopupTab').addClass('hasPopup');
      container.addClass('open');
      container.find('.Subpop[data-subpop-id=' + subpopid + ']').addClass('open');
      // subpop-id is "token<gestalt>"; surface the gestalt so the game side
      // can persist the seen-flag and clear the NEW badge across reloads.
      var gestalt = subpopid && subpopid.indexOf('token') === 0 ? subpopid.slice(5) : '';
      if (gestalt) {
        token.find('.new').remove();
        node.trigger('popup_token_seen', [gestalt]);
      }
    });

    node.jdomelem.on(
      'click touchend',
      '.SubpopClose, .Button[data-button-id=OKButton]',
      function (e) {
        e.stopPropagation();
        e.preventDefault();
        var jelem = $(this);
        jelem.removeClass('active');
        var container = jelem.parents('.PopupTab').find('.SubpopContainer');
        container.find('.Selector.open').removeClass('hasPopup');
        jelem.parents('.PopupTab').removeClass('hasPopup');
        var subpop = jelem.parents('.Subpop');
        subpop.removeClass('open');
        if (!container.find('.Subpop.open').length) {
          container.removeClass('open');
        }
      }
    );

    node.on('close_powerup', function (e, cb) {
      // unused?
      var jelem = node.lastButton;
      jelem.removeClass('active');
      var container = jelem.parents('.PopupTab').find('.SubpopContainer, .Selector');
      jelem.parents('.PopupTab').removeClass('hasPopup');
      container.removeClass('hasPopup');
      var subpop = jelem.parents('.Subpop');
      subpop.removeClass('open');
      container.removeClass('open');
      if (cb) {
        window.setTimeout(cb, 400);
      }
    });

    node.jdomelem.on(
      'click touchend',
      '.Pagination .PopupPageArrowR, .Pagination .PopupPageArrowL',
      function (e) {
        var dir_next = $(this).hasClass('PopupPageArrowR');
        var Pagination = $(this).parent();
        var Pages = Pagination.find('.PopupPage');
        var PageWrap = Pagination.find('.PopupPageWrap');
        var len = Pages.length - 1;
        var next = Pagination.find('.PopupPageArrowR');
        var prev = Pagination.find('.PopupPageArrowL');
        var active = Pages.filter(':not(.hidden)');
        var index = Number.parseInt(active.attr('data-page-id'));
        Pages.addClass('hidden');
        if (dir_next) {
          index = index + 1;
        } else {
          index = index - 1;
        }
        PageWrap.animate({ left: -(index * 540) }, 0);
        active = Pages.filter('[data-page-id=' + index + ']');
        active.removeClass('hidden');
        if (index === len) {
          next.addClass('hidden');
          prev.removeClass('hidden');
        } else if (index <= 0) {
          prev.addClass('hidden');
          next.removeClass('hidden');
        } else {
          prev.removeClass('hidden');
          next.removeClass('hidden');
        }
      }
    );

    node.on('mousemove', function (e) {
      var userPos = {};
      userPos.x = e.pageX - node.jdomelem.offset().left;
      userPos.y = e.pageY - node.jdomelem.offset().top;
      node.userAbsPos = userPos;
    });

    node.on('mousedown touchstart', function (e) {
      var userPos = {};
      userPos.x = e.pageX - node.jdomelem.offset().left;
      userPos.y = e.pageY - node.jdomelem.offset().top;
      node.userClickAbsPos = userPos;
    });

    // FIXME DEBUG example implementation on how to change active popup on state change events
    // on('states') -> all state changes
    // on('states_idle') -> specific [idle] state change.
    node.on('states', function (e, state, value) {
      //console.log(state,value);
    });
    node.on('states_idle', function (e, value) {
      //console.log('states.idle',value);
    });
  };

  Popup.prototype.render = function () {
    var node = this;
    this.jdomelem.empty();
    var html = app.renderView(this.template, this.templateData);
    this.jdomelem.append(html);
    var mbutton = this.jdomelem.find(
      '.PopupMenuButton[data-tab="' + node.templateData.lastTab + '"]'
    );
    if (node.templateData.lastTab) {
      node.jdomelem.find('.PopupMenuButton').removeClass('active');
      mbutton.addClass('active');
      node.jdomelem.find('.PopupTab').hide();
      node.jdomelem.find('.PopupTab[data-tab="' + mbutton.attr('data-tab') + '"]').show();
      node.jdomelem.find('.PopupText.TabText').hide();
      node.jdomelem.find('.PopupText.TabText[data-tab="' + mbutton.attr('data-tab') + '"]').show();
    }

    if (node.templateData.highlightTabs) {
      _.each(node.templateData.highlightTabs, function (tabid) {
        node.jdomelem.find('.PopupMenuButton[data-tab="' + tabid + '"]').addClass('TabArrowNew');
      });
    }
  };

  Popup.prototype.renderDataTab = function () {
    var htmlPS = app.renderView('profileset.html', this.templateData);
    var htmlButt = app.renderView('buttons_project.html', this.templateData);
    this.jdomelem.find('.PopupTab.data').empty().append(htmlPS).append(htmlButt);
  };

  Popup.prototype.renderPowerupSelectors = function (pkey) {
    if (!pkey) {
      return;
    }
    var pcat = this.templateData.data.powerups_compiled[pkey];
    var html = app.renderView('selector_powerups.html', {
      D: this.templateData.data,
      game_values: this.templateData.game_values,
      pcat: pcat,
      data: this.templateData.data,
      typelower: pcat.typelower,
      pkey: pkey,
    });
    var jtab = this.jdomelem.find('.PopupTab.Powerups[data-tab="' + pkey + '"]');
    jtab.find('.Subpop.InSelector').remove();
    jtab.find('.Subpop.Selector').remove();
    jtab.find('.SubpopContainer').append(html);
  };

  Popup.prototype.onAddInit = function () {
    this.height = this.jdomelem.height();
    var pbody = this.jdomelem.find('.PopupBody');
    pbody.css({ height: pbody.height() });
    this.offsetY = this.height / 2 - 10;
    this.updateRenderProp();
    if (this.placeBottom) {
      this.y = app.game.renderNode.getSize().height - this.height / 2 - 32;
    } else {
      this.y = app.game.renderNode.getSize().height / 2;
    }
    this.x = app.game.renderNode.getSize().width / 2;
    this.draw();
  };

  Popup.prototype.draw = function () {
    // Update domelem to current settings
    this.setSize(this.getSize());
    this.setTransform(this.getTransform());
    this.setPosition(this.getPosition());
    this.setOpacity(this.opacity);
  };

  Popup.prototype.close = function (cb) {
    var popup = this;
    popup.open = false;
    // uncomment below to reset lastTab
    //popup.templateData.lastTab = undefined;
    // Transitionend test
    popup.jdomelem.on(
      'otransitionend MSTransitionEnd transitionend webkitTransitionEnd',
      function (e) {
        popup.remove();
      }
    );
    window.setTimeout(function () {
      // fallback for non transition
      popup.remove();
    }, 500);
    window.setTimeout(function () {
      // Trigger Callback
      if (cb) {
        cb();
      }
    }, 250);

    if (this.popupContainer) {
      this.popupContainer.renderNode.popupContainerDomelem.removeClass(this.extendClass);
      //if (node.extendClass) { container.removeClass(node.extendClass); }
      //this.popupContainer.renderNode.unlock();
      this.popupContainer.unlock();
    }
    this.off('states');
    popup.jdomelem.addClass('close');
    // Timeout corresponds to CSS transitions
  };

  /////////////////////////////
  // The RenderSprite (helper, not the class)
  /////////////////////////////
  //
  // The legacy `var RenderSprite = function(config, frame)` helper
  // (returns a `<div class='RenderSprite'>` HTML string) moved to
  // scripts/render/renderSpriteHelper.ts in PR 38 of issue #147.
  // Aliased back to its legacy name so the publisher entry and the
  // remaining inline call site (Popup) keep working unchanged.

  var RenderSprite = renderSpriteHtml;

  /////////////////////////////
  // The RenderAmount
  /////////////////////////////

  var RenderAmount = function (amount, frame, upgradeAmount, upgradeAbsAmount) {
    config = {};

    var s = {};
    s.frameSrc = 'MainSprites.png';
    s.frameMap = {
      normal: { x: 267, y: 582, width: 80, height: 16, pivotx: 0, pivoty: -69 },
      consumed: { x: 187, y: 582, width: 80, height: 16, pivotx: 0, pivoty: -69 },
    };
    s.frame = frame || 'normal';
    s.jdomelem = $("<div class='DecoratorAmount'></div>");
    s.jdomelem2 = $("<div class='DecoratorAmountValue'></div>");
    //s.jdomelem3 = $("<div class='DecoratorAmountNum'></div>");
    s.jdomelem.append(s.jdomelem2);
    if (frame) {
      s.jdomelem.addClass(frame);
    }
    s.domelem = s.jdomelem[0];
    s.jdomelem.css({
      'background-image': 'url(' + setup.imagePathPrefix + s.frameSrc + ')',
    });
    var map = s.frameMap[s.frame];

    /*
      if (amount < 50) {
        s.jdomelem3.show();
        s.jdomelem3.text(_.toKSNum(amount));
      } else {
        s.jdomelem2.show();
        s.jdomelem3.hide();
      }
      */

    s.jdomelem.width(map.width);
    s.jdomelem.height(map.height);
    s.jdomelem.css({
      left: -map.pivotx,
      top: -map.pivoty,
    });
    s.domelem.style.backgroundPosition = -map.x + 'px ' + -map.y + 'px';
    amount = amount || 0;
    s.jdomelem2.width(Math.round((amount / 100) * 60));
    if (upgradeAmount !== undefined) {
      if (amount > 0) {
        s.jdomelem.addClass('hasUpgrade');
      }

      s.jdomelem4 = $("<div class='DecoratorAmountUpgrade'></div>");
      s.jdomelem4.width(Math.round((upgradeAmount / 100) * 60));
      s.jdomelem4.css({ left: 9 + Math.round((amount / 100) * 60) + 'px' });
      s.jdomelem.append(s.jdomelem4);

      if (upgradeAmount < 25) {
        s.jdomelem3 = $("<div class='DecoratorAmountNum'></div>");
        s.jdomelem3.text(_.toKSNum(upgradeAbsAmount));
        s.jdomelem.append(s.jdomelem3);
      }
    }

    s.html = String($('<div>').append(s.jdomelem.clone()).html());
    return s.html;
  };

  /////////////////////////////////////////
  //  The Mission Perp
  ////////////////////////////////////////

  var MissionPerp = function (config) {
    config = config || {};
    this._id = _instances.length;
    this.position = 'relative';
    this.display = 'block';
    this.clickable = true;
    this.frameSrc = config.frameSrc;
    this.frameMap = config.frameMap;
    this.frame = config.frame || 'normal';
    this.jdomelem = $("<div class='MissionPerp'></div>");
    this.domelem = this.jdomelem[0];
    this.init(config);
    this.draw();
  };
  extend(MissionPerp, Node);

  MissionPerp.prototype.onAddInit = function () {
    if (this.clickable) {
      this.setClickable(true);
    }
    this.updateRenderProp();
    this.render();
    this.initUI();
  };

  MissionPerp.prototype.setPosition = function () {
    // FIXME: maybe adapt to allow transforms
    return;
  };

  MissionPerp.prototype.setTransform = function () {
    // FIXME: maybe adapt to allow transforms
    return;
  };

  // Stub: sizing is CSS-driven.  The inherited Node.setSize would
  // otherwise write inline `width: 0px; height: 0px` (Node prototype
  // defaults) and override the CSS width.
  MissionPerp.prototype.setSize = function () {
    return;
  };

  MissionPerp.prototype.template = 'mission.html';

  MissionPerp.prototype.render = function () {
    //this.x = this.parentNode.getSize().width/2;
    this.jdomelem.removeClass('active');
    this.jdomelem.removeClass('complete');
    if (this.gameNode.states.active) {
      this.jdomelem.addClass('active');
    }
    if (this.gameNode.states.complete) {
      this.jdomelem.addClass('complete');
    }
    if (!this.gameNode.states.complete && !this.gameNode.states.active) {
      this.hide();
    } else {
      this.show();
    }
    this.jdomelem.empty();
    var html = app.renderView(this.template, this);
    this.jdomelem.append(html);
    this.draw();
  };

  MissionPerp.prototype.draw = function () {
    // Update domelem to current settings
    this.setSize(this.getSize());
    this.setTransform(this.getTransform());
    this.setPosition(this.getPosition());
    this.setOpacity(this.opacity);
  };

  MissionPerp.prototype.tick = function () {
    this.render();
  };

  MissionPerp.prototype.initUI = function () {
    var node = this;
    node.on('vclick', function (e) {
      e.stopPropagation();
    });
    node.on('states', function (e, state, value) {
      e.stopPropagation();
      node.render();
    });
    node.on('states_active', function (e, state, value) {
      e.stopPropagation();
    });
  };

  /////////////////////////////////////////
  //  The Topscore Perp
  ////////////////////////////////////////

  var TopscorePerp = function (config) {
    config = config || {};
    this._id = _instances.length;
    this.position = 'relative';
    this.hidden = true;
    this.clickable = true;
    this.frameSrc = config.frameSrc;
    this.frameMap = config.frameMap;
    this.frame = config.frame || 'normal';
    this.jdomelem = $("<div class='TopscorePerp'></div>");
    this.domelem = this.jdomelem[0];
    this.init(config);
    this.draw();
  };
  extend(TopscorePerp, Node);

  TopscorePerp.prototype.onAddInit = function () {
    if (this.clickable) {
      this.setClickable(true);
    }
    this.updateRenderProp();
    this.render();
    this.initUI();
  };

  TopscorePerp.prototype.setPosition = function () {
    // FIXME: maybe adapt to allow transforms
    return;
  };

  TopscorePerp.prototype.setTransform = function () {
    // FIXME: maybe adapt to allow transforms
    return;
  };

  TopscorePerp.prototype.template = 'topscore.html';

  TopscorePerp.prototype.render = function () {
    //this.x = this.parentNode.getSize().width/2;
    this.jdomelem.empty();
    var html = app.renderView(this.template, this);
    this.jdomelem.append(html);
    this.draw();
  };

  TopscorePerp.prototype.draw = function () {
    // Update domelem to current settings
    if (this.hidden) {
      this.hide();
    }
    this.setSize(this.getSize());
    this.setTransform(this.getTransform());
    this.setPosition(this.getPosition());
    this.setOpacity(this.opacity);
  };

  TopscorePerp.prototype.tick = function () {
    this.render();
  };

  TopscorePerp.prototype.initUI = function () {
    var node = this;
    node.on('vclick', function (e) {
      e.stopPropagation();
      node.parentNode.jdomelem.find('.TopscorePerp').removeClass('active');
      //node.jdomelem.addClass('active');
    });
    node.on('states', function (e, state, value) {
      e.stopPropagation();
      node.render();
    });
    node.on('states_active', function (e, state, value) {
      e.stopPropagation();
    });
  };

  TopscorePerp.prototype.renderRank = function () {
    var rank = this.jdomelem.find('.TopscoreRank');
    rank.empty();
    var html = app.renderView('topscore_rank.html', {
      data: this.gameNode.data,
      parentdata: this.gameNode.parentNode.data,
      type: this.gameNode.scoretype,
    });
    rank.append(html);
  };

  TopscorePerp.prototype.renderList = function () {
    var list = this.jdomelem.find('.TopscoreList');
    list.empty();
    var html = app.renderView('topscore_list.html', {
      data: this.gameNode.data,
      parentdata: this.gameNode.parentNode.data,
      type: this.gameNode.scoretype,
    });
    list.append(html);
  };

  ////////////////////////////
  // Underscore Mix-ins
  ////////////////////////////

  _.mixin({
    RenderAmount: RenderAmount,
    RenderSprite: RenderSprite,
  });

  ////////////////////////////
  // The API Publisher
  ////////////////////////////

  return {
    _instances: _instances,
    _ids: _ids,
    //_sets: _sets,
    get: get,
    getById: getById,
    clear: clear,
    DragHandler: DragHandler,
    Set: Set,
    Node: Node,
    Circle: Circle,
    Text: Text,
    Sprite: Sprite,
    Perp: Perp,
    PerpSprite: PerpSprite,
    PerpCable: PerpCable,
    Decorator: Decorator,
    DecoratorReady: DecoratorReady,
    DecoratorAmount: DecoratorAmount,
    DecoratorLabel: DecoratorLabel,
    DecoratorTimer: DecoratorTimer,
    DecoratorGear: DecoratorGear,
    DecoratorNew: DecoratorNew,
    Cable: Cable,
    MissionPerp: MissionPerp,
    TopscorePerp: TopscorePerp,
    ViewTab: ViewTab,
    ViewMap: ViewMap,
    MainMenu: MainMenu,
    ButtonInline: ButtonInline,
    Stage: Stage,
    Popup: Popup,
    SlowTicker: SlowTicker,
    Statusbar: Statusbar,
    DBQueue: DBQueue,
  };
};

var render; // We store our singleton instance here.

export function getRender() {
  render = render || Render();
  return render;
}

export default { getRender };
