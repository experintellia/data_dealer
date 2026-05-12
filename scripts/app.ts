// Application root.  Wires LocalEngine handlers, the i18n layer, and
// the Game/Render singletons.  Vendor libs ($, sprintf, createjs) are
// read off globalThis at factory-body time — they are loaded as plain
// `<script>` tags in index.html before this bundle runs.  Their typed
// surfaces are declared once in types/env.d.ts.
//
// View templates are compiled by the in-tree `compileTemplate` helper
// (scripts/dd-helpers.ts); the underscore vendor lib is no longer
// loaded.

import type { JQueryLike, JQueryStatic } from '../types/env.d.ts';
import { getGame } from './Game.js';
import LocalEngine from './LocalEngine.js';
import { getRender } from './Render.js';
import { compileTemplate, registerTemplateHelpers } from './dd-helpers.js';
import type { IntegrateResult } from './game/Database.js';
import type { BuyPerpResult, ChargeResult, DoneFailChain } from './game/GamePerp.js';
import type { RecheckMissionsResult } from './game/Missions.js';
import type { RankingResult } from './game/Topscore.js';
import i18n from './i18n.js';
import type { BuyPowerupResult, CollectResult } from './remote-types.js';
import setup from './setup.js';

// All view sources are inlined at bundle time; templates are compiled
// the first (and only) time the Application factory runs.  The
// in-tree `compileTemplate` is a ~30-line replacement for the legacy
// `_.template(text, null, { variable: 'D' })` call; templates close
// over the `_` namespace populated in scripts/dd-helpers.ts.
const viewSources = import.meta.glob<string>('../views/*.html', {
  query: '?raw',
  import: 'default',
  eager: true,
});

function compileTemplates(): Record<string, (data?: unknown) => string> {
  const out: Record<string, (data?: unknown) => string> = {};
  for (const path in viewSources) {
    const segments = path.split('/');
    const name = segments[segments.length - 1];
    if (!name) continue;
    out[name] = compileTemplate(viewSources[path] as string);
  }
  return out;
}

// Each LocalEngine handler is wrapped to return a jQuery Deferred so the
// legacy Game.js call sites can keep their .done()/.fail() chains.
//
// Known handlers are typed individually so consumers don't need to cast
// `remote.foo() as unknown as DoneFailChain<FooResult>` — drops ~17
// casts across `scripts/`.  All entries are optional because the
// wrapping pass in `Application()` is dynamic (`Object.keys(LocalEngine)`),
// so consumers must guard before calling — matching the prior shape
// where every access was already nullable in practice.
//
// `getSessionLocale` / `loadGame` keep `JQueryLike`-style returns
// because their consumers (`app.start()`, `GameRoot.continueStart`)
// chain `.then(...)` — `JQueryLike` exposes `.then`, `DoneFailChain`
// doesn't.  Future cleanup could collapse them once the GameRoot
// boot path is rewritten.
interface AppRemote {
  recheckMissions?(): DoneFailChain<RecheckMissionsResult>;
  chargePerp?(path: string): DoneFailChain<ChargeResult>;
  collectPerp?(path: string): DoneFailChain<CollectResult>;
  buyPerp?(path: string, gestalt: string): DoneFailChain<BuyPerpResult>;
  buyPowerup?(
    path: string,
    slot: number | string,
    gestalt: string
  ): DoneFailChain<BuyPowerupResult>;
  sellPowerup?(path: string, slot: number, gestalt: string): DoneFailChain<BuyPowerupResult>;
  buySlots?(path: string, slotType: string, num: number | string): DoneFailChain<BuyPowerupResult>;
  integrateCollected?(psid: string): DoneFailChain<IntegrateResult>;
  getRanking?(type: string): DoneFailChain<RankingResult>;
  getSessionLocale?(): JQueryLike;
  loadGame?(): JQueryLike;
}

interface ApplicationApi {
  debug: Record<string, unknown>;
  remote: AppRemote;
  game?: {
    trigger(ev: string, args?: unknown[]): unknown;
    getById(id: string): { trigger(ev: string, args?: unknown[]): unknown } | null;
  };
  version?: unknown;
  loadViews(): JQueryLike;
  renderView(viewName: string, data?: unknown): string;
  start(): JQueryLike;
}

function _getJQuery(): JQueryStatic {
  const $ = jQuery ?? globalThis.$;
  if (!$) throw new Error('app.ts: jQuery global not found');
  return $;
}

// Surfaces a small typed seam over `window` for the debug-globals stamp in
// app.start() so each `window.app = …` line doesn't repeat the cast.
function _setDebugGlobals(globals: Record<string, unknown>): void {
  Object.assign(window as unknown as Record<string, unknown>, globals);
}

const Application = function (): ApplicationApi {
  const $ = _getJQuery();
  const templates = compileTemplates();

  // Here we store the stuff we might need throughout the whole application.
  // `remote` is filled in below by the `Object.keys(LocalEngine).forEach`
  // wrapping pass; AppRemote's entries are all optional so the empty
  // object here is a valid starting state.
  const app: ApplicationApi = {
    debug: {},
    remote: {} as AppRemote,
    loadViews,
    renderView,
    start,
  };

  // Templates are pre-compiled at bundle time; loadViews is retained as
  // an immediately-resolved Deferred so callers (bootstrap.continueStart,
  // any Game-internal reset path) keep their `.then(...)` chains.
  function loadViews(): JQueryLike {
    return $.when();
  }

  // A nice wrapper for rendering underscore templates.
  function renderView(viewName: string, data?: unknown): string {
    const view = templates[viewName];
    if (!view) {
      console.warn('Could not render view “%s”: not bundled', viewName);
      return '';
    }
    try {
      return view(data || {});
    } catch (ex) {
      const msg =
        ex && typeof ex === 'object' && 'message' in ex
          ? String((ex as { message: unknown }).message)
          : String(ex);
      console.warn('Could not render view “%s”: %s', viewName, msg);
      return '';
    }
  }

  // Game.js still uses jQuery `.done()/.fail()` chains; wrap each
  // LocalEngine handler so callers get a Deferred instead of a native
  // Promise.  The wrapper is typed to return JQueryLike so call sites in
  // start() don't need per-call casts on the chained .then() / .fail().
  const INTERNAL_API: Record<string, true> = {
    setEmitter: true,
    setSendDelta: true,
    setSendAchievement: true,
    setPrngSeed: true,
    resetPrngSeed: true,
  };
  const engineRecord = LocalEngine as unknown as Record<string, unknown>;
  // Cast seam: every wrapped handler returns a jQuery Deferred at
  // runtime, which structurally implements both `JQueryLike` and
  // `DoneFailChain<unknown>` — but the two interfaces are declared
  // separately, so TypeScript can't see they're the same thing.  The
  // cast is local to this assignment and lets `AppRemote`'s typed
  // method signatures (recheckMissions, chargePerp, …) bind cleanly,
  // dropping ~17 `as unknown as DoneFailChain<…>` casts at consumer
  // call sites.
  Object.keys(engineRecord).forEach(function (name) {
    if (INTERNAL_API[name]) return;
    const fn = engineRecord[name];
    if (typeof fn !== 'function') return;
    const wrapped = function (...args: unknown[]): JQueryLike {
      return $.when((fn as (...a: unknown[]) => unknown).apply(LocalEngine, args));
    };
    (app.remote as Record<string, unknown>)[name] = wrapped;
  });

  function start(): JQueryLike {
    LocalEngine.setEmitter(function (ev: string, pl: unknown) {
      $(document).trigger(ev, [pl]);
    });

    // Bridge document-level engine events into the in-game event bus the
    // way the legacy socket.on("node_ready" / "new_items") handlers did
    // before #142 retired the transport plumbing. Without this,
    // _scheduleChargeReady's setTimeout publishes node_ready to document
    // but no per-perp gnode listener (which lives on gnode.jq = $(this),
    // not on document) ever fires — the timer decorator stays put and
    // the collect icon never appears.
    $(document).on('node_ready', function (_e: unknown, pl: unknown) {
      if (!app.game || !pl || typeof pl !== 'object' || !('id' in pl)) return;
      const id = (pl as { id?: unknown }).id;
      if (typeof id !== 'string') return;
      const gnode = app.game.getById(id);
      if (gnode) gnode.trigger('node_ready', [(pl as { result?: unknown }).result]);
    });
    $(document).on('new_items', function (_e: unknown, pl: unknown) {
      if (!app.game) return;
      app.game.trigger('new_items', [pl]);
    });

    $('#loadertext').text('Loading saved game');
    const getSessionLocale = app.remote.getSessionLocale;
    if (!getSessionLocale) throw new Error('app.start: getSessionLocale not wired');
    return getSessionLocale().then(function (...args: unknown[]) {
      const data = args[0] as { result?: unknown } | undefined;
      const locale = data && data.result === 'de' ? 'de_AT' : 'en_US';
      i18n.setLocale(locale);
      // type_settings runs gettext at module load — must wait for the
      // locale JSON before requiring Game.
      $('#loadertext').text('Loading translations');
      return i18n.ready().then(function () {
        const loadGame = app.remote.loadGame;
        if (!loadGame) throw new Error('app.start: loadGame not wired');
        return loadGame().then(function (...lgArgs: unknown[]) {
          const lgData = lgArgs[0] as { result?: { version?: unknown } } | undefined;
          const html = renderView('game.html');
          $('#dd-control').html(html);
          const Game = getGame();
          const gameData = lgData && lgData.result;
          app.version = gameData?.version;
          (Game as { init: (data: unknown) => void }).init(gameData);
          if (setup.debug) {
            _setDebugGlobals({ app, setup, Game, Render: getRender() });
          }
          // Expose the live `app` to the devtools surface so e2e tests
          // (window.__dd.getZoom etc.) can reach app.game without depending
          // on setup.debug being toggled in setup_local.ts.
          const dd = (window as unknown as { __dd?: { _app?: unknown } }).__dd;
          if (dd) {
            dd._app = app;
          }
        });
      });
    });
  }

  // Late-bind the two template helpers that need a closure over the
  // live Application instance: `_.renderView` (delegates back to
  // this.renderView) and `_.game` (returns the running game root).
  // The Render-side helpers (`_.RenderSprite`, `_.RenderAmount`)
  // are registered from inside `getRender()`.  Every other entry on
  // the `_` namespace is a stable function from dd-helpers.ts.
  registerTemplateHelpers({
    _: i18n.gettext,
    __: i18n.ngettext,
    renderView,
    game: function () {
      return app.game ?? {};
    },
  });

  $(function () {
    // Inject a new style element to define our main sprite image.
    // FIXME: This needs to be modified for retrieving the image path from the back-end.
    $('head').append(
      $('<style type="text/css">' as unknown as Element).html(
        '.RenderSprite {background-image: url(img/MainSprites.png);}'
      )
    );
  });

  return app;
};

let appInstance: ApplicationApi | undefined;

export function getApplication(): ApplicationApi {
  appInstance = appInstance || Application();
  return appInstance;
}

export default { getApplication };
