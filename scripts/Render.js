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
} from './render/RenderDecorators.js';
import { RenderDragHandler } from './render/RenderDragHandler.js';
import { RenderNode, setRenderNodeTickers } from './render/RenderNode.js';
import { applyRenderNodeFX } from './render/RenderNodeFX.js';
import { RenderPerp as RenderPerpClass } from './render/RenderPerp.js';
import { RenderPerpSprite as RenderPerpSpriteClass } from './render/RenderPerpSprite.js';
import { RenderSet } from './render/RenderSet.js';
import { RenderSlowTicker } from './render/RenderSlowTicker.js';
import { RenderSprite as RenderSpriteClass } from './render/RenderSprite.js';
import { RenderText as RenderTextClass } from './render/RenderText.js';
import {
  RenderDBQueue as RenderDBQueueClass,
  RenderMissionPerp as RenderMissionPerpClass,
  RenderPopup as RenderPopupClass,
  RenderStatusItem as RenderStatusItemClass,
  RenderStatusbar as RenderStatusbarClass,
  RenderTopscorePerp as RenderTopscorePerpClass,
  renderAmountHtml,
} from './render/RenderTopLevelUI.js';
import {
  RenderMainMenu as RenderMainMenuClass,
  RenderStage as RenderStageClass,
  RenderViewMap as RenderViewMapClass,
  RenderViewTab as RenderViewTabClass,
  setRenderViewsConfig,
} from './render/RenderViews.js';
import { _ids, _instances, clearAllNodes, getNode, getNodeById } from './render/renderRegistry.js';
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
  //
  // Extracted to scripts/render/renderRegistry.ts in PR 40 of
  // issue #147.  Imported as live ESM bindings (`_instances`,
  // `_ids`, `getNode`, `getNodeById`, `clearAllNodes`) so the
  // publisher's `_instances:` / `_ids:` / `get:` / `getById:` /
  // `clear:` entries keep working unchanged.  The seam from
  // PR #216 (`setRenderNodeRegistry`) is retired — RenderNode
  // imports the registry helpers directly now.

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
  //
  // Extracted to scripts/render/RenderSlowTicker.ts in PR 40 of
  // issue #147.  Aliased back to `SlowTicker` so the publisher
  // entry keeps working unchanged.  The PR #221
  // `setRenderDecoratorSlowTicker` injection seam is retired —
  // RenderDecorators imports the singleton directly now.

  var SlowTicker = RenderSlowTicker;

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
  // PR 40 of issue #147 retired the `setRenderNodeRegistry` seam —
  // RenderNode imports the registry helpers directly from
  // scripts/render/renderRegistry.ts.  Only the Ticker bridge stays
  // (CreateJS Ticker still lives in this IIFE; once it's extracted
  // too the final cleanup PR can convert this whole file to TS and
  // drop `setRenderNodeTickers` along with the rest of the IIFE
  // shell).

  var Node = RenderNode;

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
  // The Top-Level UI (Statusbar / StatusItem / DBQueue / Popup /
  // MissionPerp / TopscorePerp + the RenderAmount template helper)
  /////////////////////////////
  //
  // Extracted to scripts/render/RenderTopLevelUI.ts in PR 39 of
  // issue #147.  Aliased back to their legacy names so the
  // publisher entries and any external consumer keeps working
  // unchanged.

  var Statusbar = RenderStatusbarClass;
  var StatusItem = RenderStatusItemClass;
  var DBQueue = RenderDBQueueClass;
  var Popup = RenderPopupClass;
  var MissionPerp = RenderMissionPerpClass;
  var TopscorePerp = RenderTopscorePerpClass;
  var RenderAmount = renderAmountHtml;

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
    get: getNode,
    getById: getNodeById,
    clear: clearAllNodes,
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
