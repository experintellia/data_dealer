/// <reference types="vite/client" />
// Pull in the official webxdc global types (window.webxdc: Webxdc<…>).
import type { Webxdc } from '@webxdc/types';
import '@webxdc/types/global';

// ---------------------------------------------------------------------------
// Vendor-globals surface — narrow, project-local types for the vendored libs
// loaded as plain `<script>` tags before the ESM bundle.  Real DefinitelyTyped
// packages would be wider; we only declare the members our scripts actually
// touch so consumers don't accidentally rely on un-loaded methods.
// ---------------------------------------------------------------------------

export interface JQueryLike {
  html(content: string): unknown;
  text(content: string): unknown;
  trigger(ev: string, args?: unknown[]): unknown;
  append(child: unknown): unknown;
  attr(name: string): string | undefined;
  on(ev: string, handler: (...args: unknown[]) => void): unknown;
  off(ev?: string): unknown;
  fail(handler: (...args: unknown[]) => unknown): JQueryLike;
  then(
    onResolved?: (...args: unknown[]) => unknown,
    onRejected?: (...args: unknown[]) => unknown
  ): JQueryLike;
}

export interface JQueryStatic {
  // jQuery's call signature is intentionally wide — Game.js wraps every
  // GameNode (`$(this)`) into a per-node event bus, so the selector
  // accepts any object identity in addition to the standard CSS/DOM forms.
  (selector: string | Element | Document | (() => void) | object): JQueryLike;
  when(...args: unknown[]): JQueryLike;
}

export interface UnderscoreStatic {
  template(text: string, data: unknown, settings: { variable: string }): (data?: unknown) => string;
  mixin(mixins: Record<string, unknown>): void;
  sprintf(template: string, ...subs: unknown[]): string;
  span(text: string, cls?: string): string;
  toKSNum(n: number): string;
  numeral(n: number): { format(fmt: string): string };
  pad0(n: number, length: number): string;
  // Open-ended for the long tail of underscore methods used elsewhere.
  [key: string]: unknown;
}

export type NumeralStatic = (n: number) => { format(fmt: string): string };

export type SprintfFn = (template: string, ...subs: unknown[]) => string;

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

  // Vendor libs loaded via <script> tags before scripts/esm-bundle.js — see
  // index.html.  Declared as bare globals so `_`, `$`, `numeral`, `sprintf`
  // resolve to the typed surfaces above without per-call-site casts.
  // jQuery / $ is a real `| undefined` because some test environments don't
  // load it; the others are present whenever this bundle runs.
  var _: UnderscoreStatic;
  var jQuery: JQueryStatic | undefined;
  var $: JQueryStatic | undefined;
  var numeral: NumeralStatic;
  var sprintf: SprintfFn;
}
