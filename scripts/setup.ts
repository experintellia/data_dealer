// General settings used across the application.  Loaded after the vendor
// libs are available; mutable so i18n.setLocale() / app.start() can stamp
// `locale` / `localeShort` onto it for templates that read setup.locale.

import setupLocal from './setup_local.js';

export interface Setup {
  /** Set this to true to import modules into the global scope. */
  debug: boolean;
  /** The character separating items in path definitions like `Imperium.1234567890.9876543210`. */
  pathSeparator: string;
  /** The character separating items in type definitions like `ProjectPerp:project001`. */
  typeSeparator: string;
  /** The URL path prefix for accessing the images directory. */
  imagePathPrefix: string;
  /** The DOM container the game is rendered into. */
  renderContainer: string;
  /** Set to true to enable 3D parallax scrolling of the game board. */
  viewMapPerspective: boolean;
  /** The amount of pixels the game board can be dragged further than its actual size. */
  viewMapStopZone: number;
  /** Stamped at runtime by i18n.setLocale (e.g. 'de_AT', 'en_US'). */
  locale?: string;
  /** Stamped at runtime by i18n.setLocale (e.g. 'de', 'en'). */
  localeShort?: string;
}

export type SetupOverrides = Partial<Setup>;

const defaults: Setup = {
  debug: false,
  pathSeparator: '.',
  typeSeparator: ':',
  imagePathPrefix: '/img/',
  renderContainer: '#GameContainer',
  viewMapPerspective: false,
  viewMapStopZone: 0,
};

const setup: Setup = Object.assign({}, defaults, setupLocal);

export default setup;
