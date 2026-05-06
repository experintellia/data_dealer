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
  ///////////////////////////////////
  //
  // Fully extracted to scripts/game/GameRoot.ts in PRs 19-24 of issue
  // #147.  The class is imported above; the API publisher at the
  // bottom of this IIFE re-exposes it as Game.GameRoot.  APTicker /
  // AniTicker singletons are injected via setAPTickerForGameRoot /
  // setAniTickerForGameRoot at the IIFE tail.

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
