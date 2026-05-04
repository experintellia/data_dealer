// Application root.  Owns the wiring between the LocalEngine handlers,
// the i18n layer, and the Game/Render singletons.  Pure ESM (issue #58).
//
// Vendor libs ($, _, numeral, sprintf, createjs, etc.) are still global —
// they are loaded as plain `<script>` tags in index.html before this
// bundle runs and exposed via window — so we read them off globalThis at
// factory-body time.  No more RequireJS, no more AMD bridge.

import setup from './setup.js';
import i18n from './i18n.js';
import LocalEngine from './LocalEngine.js';
import { getGame } from './Game.js';
import { getRender } from './Render.js';

// Pre-compile every <view>.html template at bundle time.  Each entry is
// a function `(data) => html` that runs through underscore's template
// engine with the legacy `D` variable name (a holdover from the AMD-era
// `tpl` plug-in's variable-naming setting).
const viewSources = import.meta.glob('../views/*.html', {
  query: '?raw',
  import: 'default',
  eager: true,
});

// Map basename ('foo.html') → compiled template fn.  Compilation happens
// the first time the Application factory runs (after vendor underscore
// has set window._); doing it here would crash because `_` is not yet
// defined at module-evaluation time.
let _templates = null;
function compileTemplates() {
  if (_templates) return _templates;
  const _ = globalThis._;
  _templates = {};
  for (const path in viewSources) {
    const name = path.split('/').pop();
    // underscore 1.5.1: `_.template(text, data, settings)`; pass null
    // for data so we get a compiled function rather than eager output.
    _templates[name] = _.template(viewSources[path], null, { variable: 'D' });
  }
  return _templates;
}

const Application = function() {

  const _ = globalThis._;
  const $ = globalThis.jQuery || globalThis.$;
  const numeral = globalThis.numeral;
  const templates = compileTemplates();

  // Here we store the stuff we might need throughout the whole application.
  const app = {
    debug: {},
  };

  // Templates are pre-compiled at bundle time; loadViews is retained as
  // an immediately-resolved Deferred so callers (bootstrap.continueStart,
  // any Game-internal reset path) keep their `.then(...)` chains.
  app.loadViews = function() {
    return $.when();
  };

  // A nice wrapper for rendering underscore templates.
  app.renderView = function(viewName, data) {
    const view = templates[viewName];
    if (!view) {
      console.warn('Could not render view “%s”: not bundled', viewName);
      return '';
    }
    try {
      return view(data || {});
    } catch (ex) {
      console.warn('Could not render view “%s”: %s', viewName, ex.message);
      return '';
    }
  };

  // Wrap each LocalEngine handler so callers get a jQuery Deferred —
  // Game.js still uses .done()/.fail() chains.  $.when adopts the native
  // Promise returned by the handler.
  const INTERNAL_API = { setEmitter: 1, setSendDelta: 1, setPrngSeed: 1 };
  app.remote = {};
  Object.keys(LocalEngine).forEach(function(name) {
    if (INTERNAL_API[name]) return;
    const fn = LocalEngine[name];
    if (typeof fn !== 'function') return;
    app.remote[name] = function() {
      return $.when(fn.apply(LocalEngine, arguments));
    };
  });

  app.start = function() {
    LocalEngine.setEmitter(function(ev, pl) {
      $(document).trigger(ev, [pl]);
    });

    $('#loadertext').text('Loading saved game');
    return app.remote.getSessionLocale().then(function(data) {
      const locale = data.result === 'de' ? 'de_AT' : 'en_US';
      i18n.setLocale(locale);
      // type_settings runs gettext at module load — must wait for the
      // locale JSON before requiring Game.
      $('#loadertext').text('Loading translations');
      return i18n.ready().then(function() {
        return app.remote.loadGame().then(function(data) {
          const html = app.renderView('game.html');
          $('#dd-control').html(html);
          const Game = getGame();
          const gameData = data.result;
          app.version = gameData.version;
          Game.init(gameData);
          if (setup.debug) {
            window.app = app;
            window.setup = setup;
            window.Game = Game;
            window.Render = getRender();
          }
        });
      });
    });
  };

  // Extending Underscore with some helpers for easier templating.
  _.mixin({
    mixindone: function() { return true; },
    game: function() {
      // FIXME: only expose certain functions to _
      if (app.game) { return app.game; }
      else { return {}; }
    },
    numeral: numeral,
    // vendor/sprintf.js sets window.sprintf when loaded as a plain
    // <script> tag — its anonymous AMD define is now a no-op since
    // there is no AMD loader to register with.
    sprintf: window.sprintf,
    renderView: app.renderView,
    pad0: function(number, length) {
      // Fastest implementation according to http://jsperf.com/ways-to-0-pad-a-number
      const N = Math.pow(10, length);
      return number < N ? ('' + (N + number)).slice(1) : '' + number;
    },
    crlf2html: function(str) {
      return String(str || '').replace(new RegExp('\r?\n|\r', 'g'), '<br>');
    },
    toKSNum: function(number) {
      // To activate german language set:
      //_.numeral.language('de-de');  // load vendor/numeral-de.js first
      return _.numeral(number).format('0,0');
    },
    toTime: function(ms) {
      const date = new Date(ms || 0);
      if (ms >= 3600000) {
        return _.pad0(date.getUTCHours(), 2) + ':' +
               _.pad0(date.getUTCMinutes(), 2) + ':' +
               _.pad0(date.getUTCSeconds(), 2);
      } else {
        return _.pad0(date.getUTCMinutes(), 2) + ':' +
               _.pad0(date.getUTCSeconds(), 2);
      }
    },
    span: function(text, CSSClass) {
      CSSClass = CSSClass || 'highlight';
      return '<span class="' + CSSClass + '">' + text + '</span>';
    },
    _: i18n.gettext,
    __: i18n.ngettext,
  });


  $(function() {
    // Inject a new style element to define our main sprite image.
    // FIXME: This needs to be modified for retrieving the image path from the back-end.
    $('head').append($('<style type="text/css">')
        .html('.RenderSprite {background-image: url(img/MainSprites.png);}'));
  });

  return app;
};

let appInstance;

export function getApplication() {
  appInstance = appInstance || new Application();
  return appInstance;
}

export default { getApplication };
