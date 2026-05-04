/// <reference types="vite/client" />
// Pull in the official webxdc global types (window.webxdc: Webxdc<…>).
import type { Webxdc } from '@webxdc/types';
import '@webxdc/types/global';

declare global {
  // Declare webxdc as a bare global in addition to window.webxdc.  Scripts in
  // this project guard access with `typeof webxdc !== 'undefined'` before using
  // it, so the type includes `undefined` to reflect the pre-messenger state.
  //
  // PayloadType = unknown forces consumers to narrow before reading fields off
  // received status updates.  Phase 7 (issue #147) tightens this further by
  // typing each call site with the specific payload shape it expects (Delta
  // for state-sync updates, etc.).
  var webxdc: Webxdc<unknown> | undefined;
}
