// Define paths to vendored libs. All paths are relative to scripts/ (one level up = project root).
require.config({
  config: {
    'tpl': {
      variable: 'D'
    }
  },
  //enforceDefine: true,
  paths: {
    baseUrl: '.',
    'createjs-easel': '../vendor/easeljs',
    'createjs-preload': '../vendor/preloadjs',
    'createjs-tween': '../vendor/tweenjs',
    'createjs-sound': '../vendor/soundjs',
    jquery: '../vendor/jquery',
    'jquery-migrate': '../vendor/jquery-migrate',
    'jquery-mobile': '../vendor/jquery-mobile',
    json2: '../vendor/json2',
    'native-console': '../vendor/native-console',
    numeral: '../vendor/numeral',
    'numeral-de': '../vendor/numeral-de',
    preload: '../vendor/preloadjs',
    routie: '../vendor/routie',
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
    'createjs-preload': {
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
    'json2': {
      exports: 'JSON'
    },
    'native-console': {
      exports: 'console'
    },
    'numeral-de': {
      deps: ['numeral']
    },
    preload: {
      exports: 'createjs.LoadQueue'
    },
    'routie': {
      exports: 'routie'
    },
    'sprintf': {
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
