// Define paths to vendored libs. All paths are relative to scripts/ (one level up = project root).
require.config({
  config: {
    'tpl': {
      variable: 'D'
    }
  },
  paths: {
    'createjs-easel': '../vendor/easeljs',
    'createjs-tween': '../vendor/tweenjs',
    'createjs-sound': '../vendor/soundjs',
    jquery: '../vendor/jquery',
    'jquery-migrate': '../vendor/jquery-migrate',
    'jquery-mobile': '../vendor/jquery-mobile',
    'native-console': '../vendor/native-console',
    numeral: '../vendor/numeral',
    'numeral-de': '../vendor/numeral-de',
    sprintf: '../vendor/sprintf',
    text: '../vendor/text',
    tpl: '../vendor/tpl',
    underscore: '../vendor/underscore',
    'zynga-animate': '../vendor/zynga-animate',
    'zynga-scroller': '../vendor/zynga-scroller'
  },
  shim: {
    'createjs-easel': {
      exports: 'createjs'
    },
    'createjs-sound': {
      exports: 'createjs'
    },
    'createjs-tween': {
      deps: ['createjs-easel'],
      exports: 'createjs.Tween'
    },
    'jquery-migrate': ['jquery'],
    'jquery-mobile': ['jquery'],
    'native-console': {
      exports: 'console'
    },
    'numeral-de': {
      deps: ['numeral']
    },
    'sprintf': {
      // Note: vendor/sprintf.js has an anonymous define() that returns
      // {sprintf, vsprintf} — RequireJS prefers that over this shim,
      // so consumers (Game.js, app.js) read window.sprintf directly.
      // The shim is left here for clarity.
      exports: 'sprintf'
    },
    'zynga-animate': {
      exports: 'core'
    },
    'zynga-scroller': {
      deps: ['zynga-animate'],
      exports: 'Scroller',
      init: function() {
        /*global Scroller*/
        return Scroller;
      }
    },
    underscore: {
      exports: '_'
    }
  }
});

require(['bootstrap']);
