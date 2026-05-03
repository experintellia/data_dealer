// This file is loaded after the library dependencies are met and before the core modules are loaded. It defines general settings used in various parts and modules of the application.

define(function(require) {

  var _ = require('underscore');

  var setup = {};

  // To override setup values the file `setup_local.js` can be used. To prevent 404 errors and the use of try/catch it must exist in any case, even if no settings are overridden.
  setup = _.extend(setup, require('setup_local'));

  setup = _.extend({
    // Set this to true to import modules into the global scope.
    debug: false,

    // ### Game and render engine settings
    // The character separating items in path definitions like `Imperium.1234567890.9876543210`.
    pathSeparator: '.',
    // The character separating items in type definitions like `ProjectPerp:project001`.
    typeSeparator: ':',
    // The URL path prefix for accessing the images directory.
    imagePathPrefix: '/img/',
    // The DOM container the game is rendered into.
    renderContainer:'#GameContainer',
    // Set to true to enable 3D parallax scrolling of the game board.
    viewMapPerspective: false,
    // The amount of pixels the game board can be dragged further than its actual size.
    viewMapStopZone: 0
  }, setup);

  return setup;
});
