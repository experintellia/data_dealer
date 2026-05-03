// Pull in the official webxdc global types (window.webxdc: Webxdc<any>).
import type { Webxdc } from "@webxdc/types";
import "@webxdc/types/global";

declare global {
  // Declare webxdc as a bare global in addition to window.webxdc.  Scripts in
  // this project guard access with `typeof webxdc !== 'undefined'` before using
  // it, so the type includes `undefined` to reflect the pre-messenger state.
  var webxdc: Webxdc<any> | undefined;
}
