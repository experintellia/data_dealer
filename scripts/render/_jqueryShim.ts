// Shared jQuery + underscore vendor-globals access for the Render
// layer.  Consolidates two formerly-duplicated patterns from the
// 12-module Render extraction:
//
//   1. The `getJQuery()` guard — every Render* module checked
//      `globalThis.jQuery ?? globalThis.$` and threw a
//      module-specific "requires the jQuery global to be loaded"
//      error if absent.  `getRenderJQuery(callerName)` does that
//      once.
//
//   2. The per-module narrow `JQuery*Elem` interfaces (one per
//      Render* module, each with a slightly different subset of
//      jQuery's surface).  The 73-some
//      `as unknown as JQuery*Elem` casts those interfaces forced
//      were noise that future contributors copy-paste because
//      they look load-bearing.  `JQueryRenderElem` is the
//      canonical wide surface — every Render* module imports it
//      and the casts retire.
//
// Render-side jQuery use is uniform: a single jQuery wrapper, a
// stable subset of methods (~30), and overloads where the legacy
// API differs by arity (`attr(name)` vs `attr(name, value)`,
// `width()` vs `width(value)`, etc.).

// ── primary element wrapper ─────────────────────────────────────────────────

/**
 * The wide jQuery-wrapper surface that every Render* module needs.
 * Generic in the underlying DOM element type so canvas-backed
 * wrappers (Cable, Circle) can narrow `[0]` to `HTMLCanvasElement`
 * via `JQueryRenderElem<HTMLCanvasElement>`.
 *
 * Method overload signatures match jQuery 3.x's runtime:
 * `attr(name)` / `width()` / `height()` / `html()` are getters
 * returning `string | undefined` / `number | undefined` /
 * `string | undefined`; their setter forms return the wrapper for
 * chaining.
 */
export interface JQueryRenderElem<E extends HTMLElement = HTMLElement> {
  0: E;
  length: number;

  // attribute / class manipulation
  attr(name: string): string | undefined;
  attr(name: string, value: string | number): JQueryRenderElem<E>;
  addClass(cls: string): JQueryRenderElem<E>;
  removeClass(cls: string): JQueryRenderElem<E>;
  toggleClass(cls: string, force?: boolean): JQueryRenderElem<E>;
  hasClass(cls: string): boolean;

  // dom manipulation / traversal
  append(child: unknown): JQueryRenderElem<E>;
  empty(): JQueryRenderElem<E>;
  remove(): JQueryRenderElem<E>;
  clone(): JQueryRenderElem<E>;
  find(selector: string): JQueryRenderElem;
  filter(selector: string): JQueryRenderElem;
  parents(selector: string): JQueryRenderElem;
  parent(): JQueryRenderElem;
  nextAll(selector: string): JQueryRenderElem;

  // content
  html(): string;
  html(content: string): JQueryRenderElem<E>;
  text(): string;
  text(value: string | number): JQueryRenderElem<E>;

  // visibility
  show(): JQueryRenderElem<E>;
  hide(): JQueryRenderElem<E>;
  toggle(): JQueryRenderElem<E>;

  // dimensions
  width(): number | undefined;
  width(value: number): JQueryRenderElem<E>;
  height(): number | undefined;
  height(value: number): JQueryRenderElem<E>;

  // events
  on<E2 extends JQueryRenderEvent = JQueryRenderEvent>(
    event: string,
    selectorOrHandler: string | ((e: E2, ...args: unknown[]) => void),
    handler?: (e: E2, ...args: unknown[]) => void
  ): JQueryRenderElem<E>;
  off(event?: string, handler?: (e: JQueryRenderEvent) => void): JQueryRenderElem<E>;
  trigger(event: string, params?: unknown[]): JQueryRenderElem<E>;

  // layout / styling
  offset(): { left: number; top: number };
  css(props: Record<string, string | number>): JQueryRenderElem<E>;
  animate(
    props: Record<string, string | number>,
    duration?: number,
    cb?: () => void
  ): JQueryRenderElem<E>;

  // iteration
  each(fn: (this: HTMLElement) => void): JQueryRenderElem<E>;

  // legacy: some Render* code stamps `hidden` directly on the
  // wrapper as a memoised visibility flag (DecoratorTimer's text
  // overlay, popup-tab show/hide).  Preserved on the structural
  // surface so those assignments type-check without casts.
  hidden?: boolean;
}

/**
 * Render-side jQuery event surface.  Wide-but-narrow: every field
 * actually read in a Render-side handler is here, nothing more.
 * Native DOM events (Mouse/Touch/Wheel) merge into this through
 * jQuery's normalisation.
 */
export interface JQueryRenderEvent {
  pageX?: number;
  pageY?: number;
  shiftKey?: boolean;
  type?: string;
  scale?: number;
  deltaY?: number;
  deltaMode?: number;
  timeStamp?: number;
  touches?: ArrayLike<{ pageX: number; pageY: number; target?: { tagName?: string } }>;
  originalEvent?: {
    touches?: ArrayLike<{ pageX: number; pageY: number }>;
    changedTouches?: ArrayLike<{ pageX: number; pageY: number }>;
  };
  target?: unknown;
  preventDefault(): void;
  stopPropagation(): void;
}

// ── factory accessor ────────────────────────────────────────────────────────

export type JQueryRenderFactory = (
  selector: string | Element | object
) => JQueryRenderElem<HTMLElement>;

/**
 * Read jQuery off `globalThis.jQuery ?? globalThis.$`, throwing if
 * the vendor `<script>` tag hasn't loaded yet.  `callerName` is
 * baked into the error message so the failing module is obvious
 * from a stack-less throw (mostly relevant in test environments).
 */
export function getRenderJQuery(callerName: string): JQueryRenderFactory {
  const jq = (globalThis.jQuery ?? globalThis.$) as JQueryRenderFactory | undefined;
  if (!jq) {
    throw new Error(callerName + ' requires the jQuery global to be loaded.');
  }
  return jq;
}
