// @ts-nocheck — strict-TS quarantine; remove when this file is migrated to TS (issue #147)
// General settings used across the application.  Loaded after the vendor
// libs are available; mutable so i18n.setLocale() / app.start() can stamp
// `locale` / `localeShort` onto it for templates that read setup.locale.

import setupLocal from './setup_local.js';

const defaults = {
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
  renderContainer: '#GameContainer',
  // Set to true to enable 3D parallax scrolling of the game board.
  viewMapPerspective: false,
  // The amount of pixels the game board can be dragged further than its actual size.
  viewMapStopZone: 0,
};

const setup = Object.assign({}, defaults, setupLocal);

export default setup;
