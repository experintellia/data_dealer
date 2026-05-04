// Application root.  Wires LocalEngine handlers, the i18n layer, and
// the Game/Render singletons.  Vendor libs ($, _, numeral, sprintf,
// createjs) are read off globalThis at factory-body time — they are
// loaded as plain `<script>` tags in index.html before this bundle
// runs.

import { getGame } from './Game.js';
import LocalEngine from './LocalEngine.js';
import { getRender } from './Render.js';
import i18n from './i18n.js';
import setup from './setup.js';

// ---------------------------------------------------------------------------
// Vendor-global types — narrow surface that this module touches.  Real
// jQuery / underscore / numeral types ship with their own packages but the
// vendored copies in vendor/ aren't on a typed import path; declare what we
// use locally so the module compiles without pulling DefinitelyTyped.
// ---------------------------------------------------------------------------

interface JQueryLike {
  html(content: string): unknown;
  text(content: string): unknown;
  trigger(ev: string, args?: unknown[]): unknown;
  append(child: unknown): unknown;
  on(ev: string, handler: (...args: unknown[]) => void): unknown;
  fail(handler: (...args: unknown[]) => unknown): JQueryLike;
  then(
    onResolved?: (...args: unknown[]) => unknown,
    onRejected?: (...args: unknown[]) => unknown
  ): JQueryLike;
}
interface JQueryStatic {
  (selector: string | Element | Document | (() => void)): JQueryLike;
  when(...args: unknown[]): JQueryLike;
}

interface UnderscoreStatic {
  template(text: string, data: unknown, settings: { variable: string }): (data?: unknown) => string;
  mixin(mixins: Record<string, unknown>): void;
  sprintf(template: string, ...subs: unknown[]): string;
  toKSNum(n: number): string;
  numeral(n: number): { format(fmt: string): string };
  pad0(n: number, length: number): string;
  // Open-ended for the long tail of underscore methods used elsewhere.
  [key: string]: unknown;
}

type NumeralStatic = (n: number) => { format(fmt: string): string };

// All view sources are inlined at bundle time; templates are compiled
// the first (and only) time the Application factory runs, when
// vendor underscore is guaranteed to have set window._.  Doing it at
// module-eval time would crash because `_` is not yet on globalThis.
const viewSources = import.meta.glob<string>('../views/*.html', {
  query: '?raw',
  import: 'default',
  eager: true,
});

function compileTemplates(): Record<string, (data?: unknown) => string> {
  const _ = (globalThis as unknown as { _: UnderscoreStatic })._;
  const out: Record<string, (data?: unknown) => string> = {};
  for (const path in viewSources) {
    const segments = path.split('/');
    const name = segments[segments.length - 1];
    if (!name) continue;
    // underscore 1.5.1's signature is `_.template(text, data, settings)`;
    // pass null for data so we get back a precompiled function.
    out[name] = _.template(viewSources[path] as string, null, { variable: 'D' });
  }
  return out;
}

interface AppRemote {
  // Each LocalEngine handler is wrapped to return a jQuery Deferred so the
  // legacy Game.js call sites can keep their .done()/.fail() chains.
  [name: string]: (...args: unknown[]) => JQueryLike;
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
  const g = globalThis as unknown as { jQuery?: JQueryStatic; $?: JQueryStatic };
  const $ = g.jQuery ?? g.$;
  if (!$) throw new Error('app.ts: jQuery global not found');
  return $;
}

const Application = function (): ApplicationApi {
  const _ = (globalThis as unknown as { _: UnderscoreStatic })._;
  const $ = _getJQuery();
  const numeral = (globalThis as unknown as { numeral: NumeralStatic }).numeral;
  const sprintfFn = (window as unknown as { sprintf: (...args: unknown[]) => string }).sprintf;
  const templates = compileTemplates();

  // Here we store the stuff we might need throughout the whole application.
  const app: ApplicationApi = {
    debug: {},
    remote: {},
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
  // Promise.
  const INTERNAL_API: Record<string, true> = {
    setEmitter: true,
    setSendDelta: true,
    setSendAchievement: true,
    setPrngSeed: true,
  };
  const engineRecord = LocalEngine as unknown as Record<string, unknown>;
  Object.keys(engineRecord).forEach(function (name) {
    if (INTERNAL_API[name]) return;
    const fn = engineRecord[name];
    if (typeof fn !== 'function') return;
    app.remote[name] = function (...args: unknown[]) {
      return $.when((fn as (...a: unknown[]) => unknown).apply(LocalEngine, args));
    };
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
    return (getSessionLocale() as JQueryLike).then(function (...args: unknown[]) {
      const data = args[0] as { result?: unknown } | undefined;
      const locale = data && data.result === 'de' ? 'de_AT' : 'en_US';
      i18n.setLocale(locale);
      // type_settings runs gettext at module load — must wait for the
      // locale JSON before requiring Game.
      $('#loadertext').text('Loading translations');
      return i18n.ready().then(function () {
        const loadGame = app.remote.loadGame;
        if (!loadGame) throw new Error('app.start: loadGame not wired');
        return (loadGame() as JQueryLike).then(function (...lgArgs: unknown[]) {
          const lgData = lgArgs[0] as { result?: { version?: unknown } } | undefined;
          const html = renderView('game.html');
          $('#dd-control').html(html);
          const Game = getGame();
          const gameData = lgData && lgData.result;
          app.version = gameData?.version;
          (Game as { init: (data: unknown) => void }).init(gameData);
          if (setup.debug) {
            (window as unknown as Record<string, unknown>).app = app;
            (window as unknown as Record<string, unknown>).setup = setup;
            (window as unknown as Record<string, unknown>).Game = Game;
            (window as unknown as Record<string, unknown>).Render = getRender();
          }
        }) as JQueryLike;
      }) as unknown as JQueryLike;
    });
  }

  // Extending Underscore with some helpers for easier templating.
  _.mixin({
    mixindone: function () {
      return true;
    },
    game: function () {
      // FIXME: only expose certain functions to _
      if (app.game) {
        return app.game;
      }
      return {};
    },
    numeral: numeral,
    sprintf: sprintfFn,
    renderView: renderView,
    pad0: function (n: number, length: number) {
      // Fastest implementation according to http://jsperf.com/ways-to-0-pad-a-number
      const N = 10 ** length;
      return n < N ? ('' + (N + n)).slice(1) : '' + n;
    },
    crlf2html: function (str: unknown) {
      return String(str || '').replace(/\r?\n|\r/g, '<br>');
    },
    toKSNum: function (n: number) {
      return _.numeral(n).format('0,0');
    },
    toTime: function (ms: number) {
      const date = new Date(ms || 0);
      if (ms >= 3600000) {
        return (
          _.pad0(date.getUTCHours(), 2) +
          ':' +
          _.pad0(date.getUTCMinutes(), 2) +
          ':' +
          _.pad0(date.getUTCSeconds(), 2)
        );
      }
      return _.pad0(date.getUTCMinutes(), 2) + ':' + _.pad0(date.getUTCSeconds(), 2);
    },
    span: function (text: string, CSSClass?: string) {
      const cls = CSSClass || 'highlight';
      return '<span class="' + cls + '">' + text + '</span>';
    },
    _: i18n.gettext,
    __: i18n.ngettext,
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
