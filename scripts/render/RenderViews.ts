// Render-side view containers — the four classes that host every
// other render primitive on screen:
//
//   - `RenderViewTab` — generic HTML-template-driven tab pane;
//     hosts mission cards, profile sets, etc.  Listens for
//     `states_active` to fade in/out, and forwards delegated
//     `.ViewTabMenuButton` / `.Button` click events to the gameNode.
//   - `RenderViewMap` — the pannable / zoomable perp surface.  Owns
//     the Scroller instance + its touch / mouse / wheel pipeline,
//     the zoom-button widget, and the scrollend trigger that GameRoot
//     uses to debounce its centre-on-active recenter.
//   - `RenderStage` — top-level viewport that owns the popup
//     container and tracks userAbsPos / userClickAbsPos for the
//     decorator FX positioning.
//   - `RenderMainMenu` — header chrome that extends Stage; renders
//     the .mm-tab nav, the cloned mobile XP bar, and forwards
//     button clicks to GameRoot.
//
// Extracted from scripts/Render.js's IIFE in PR 38 of issue #147.
//
// Two seam dependencies:
//   - `setRenderViewsApp` — for `app.renderView(template, data)` and
//     `app.game.resetZoom()`.  app is a singleton initialised by
//     scripts/app.ts; Render.js wires the seam at IIFE-body time.
//   - `setRenderViewsConfig` — for `viewMapStopZone` (read off
//     scripts/setup.ts).  Bundled with `app` in `setRenderViewsHooks`.

import appModule from '../app.js';
import setup from '../setup.js';
import { RenderDragHandler } from './RenderDragHandler.js';
import { type JQueryNodeElem, type NodeConfig, RenderNode } from './RenderNode.js';
import { type SpriteHelperConfig, renderSpriteHtml } from './renderSpriteHelper.js';

// ── seam: app + renderConf ──────────────────────────────────────────────────

interface AppLike {
  renderView(viewName: string, data?: unknown): string;
  game?: {
    resetZoom?(): void;
  };
}

export interface RenderViewsConfig {
  viewMapStopZone: number;
}

let _config: RenderViewsConfig = { viewMapStopZone: 200 };

export function setRenderViewsConfig(c: RenderViewsConfig): void {
  _config = c;
}

function getApp(): AppLike {
  return appModule.getApplication() as unknown as AppLike;
}

// ── jQuery surface ──────────────────────────────────────────────────────────

interface JQueryViewElem {
  0: HTMLElement;
  attr(name: string, value?: string): string | undefined | unknown;
  addClass(cls: string): unknown;
  removeClass(cls: string): unknown;
  toggleClass(cls: string, force?: boolean): unknown;
  append(child: unknown): unknown;
  empty(): unknown;
  html(content?: string): unknown;
  find(selector: string): JQueryViewElem;
  text(): string;
  on(
    ev: string,
    selector: string | ((e: ViewDomEvent) => void),
    handler?: (e: ViewDomEvent) => void
  ): unknown;
  off(ev?: string): unknown;
  trigger(ev: string, params?: unknown[]): unknown;
  offset(): { left: number; top: number };
  css(props: Record<string, string | number>): unknown;
}

interface ViewDomEvent {
  pageX?: number;
  pageY?: number;
  timeStamp?: number;
  scale?: number;
  deltaY?: number;
  deltaMode?: number;
  touches?: ArrayLike<{ pageX: number; pageY: number; target?: { tagName?: string } }>;
  preventDefault(): void;
  stopPropagation(): void;
}

function getJQuery(): (selector: string | object) => JQueryViewElem {
  const jq = (globalThis.jQuery ?? globalThis.$) as
    | ((selector: string | object) => JQueryViewElem)
    | undefined;
  if (!jq) {
    throw new Error('RenderViews requires the jQuery global to be loaded.');
  }
  return jq;
}

// ── Scroller (vendor) ───────────────────────────────────────────────────────

interface ScrollerOptions {
  zooming?: boolean;
  locking?: boolean;
  bouncing?: boolean;
  animating?: boolean;
  animationDuration?: number;
  minZoom?: number;
  maxZoom?: number;
}

interface ScrollerLike {
  options: ScrollerOptions;
  __isDecelerating: boolean;
  __isDragging: boolean;
  __isAnimating: boolean;
  __zoomLevel?: number;
  setDimensions(stageW: number, stageH: number, contentW: number, contentH: number): void;
  setPosition(x: number, y: number): void;
  scrollTo(x: number, y: number, animate?: boolean): void;
  zoomTo(level: number, animate?: boolean, originX?: number, originY?: number): void;
  doTouchStart(touches: ArrayLike<{ pageX: number; pageY: number }>, ts?: number): void;
  doTouchMove(
    touches: ArrayLike<{ pageX: number; pageY: number }>,
    ts?: number,
    scale?: number
  ): void;
  doTouchEnd(ts?: number): void;
}

interface ScrollerCtor {
  new (
    callback: (left: number, top: number, zoom: number) => void,
    options: ScrollerOptions
  ): ScrollerLike;
}

function getScroller(): ScrollerCtor {
  const sc = (globalThis as { Scroller?: ScrollerCtor }).Scroller;
  if (!sc) {
    throw new Error('RenderViews requires the Scroller vendor global to be loaded.');
  }
  return sc;
}

// ── ViewTab ─────────────────────────────────────────────────────────────────

export type ViewTabConfig = NodeConfig & {
  width?: number;
  height?: number;
};

export class RenderViewTab extends RenderNode {
  jdomelem1: JQueryViewElem;
  jdomelem3: JQueryViewElem;
  domelem1: HTMLElement;
  declare RenderTemplate: string | undefined;
  declare lastButton: JQueryViewElem | undefined;

  constructor(config: ViewTabConfig = {}) {
    const $ = getJQuery();
    const jdomelem = $("<div class='ViewTab'></div>");
    const jdomelem1 = $("<div class='ViewTabContainer'></div>");
    const jdomelem3 = $("<div class='PopupContainer'></div>");
    jdomelem.append(jdomelem1);
    jdomelem.append(jdomelem3);

    // FIXME: Better collect which events we're listening to
    jdomelem3.on('mousedown mouseup touchstart touchend dblclick dbltap tap', (e) => {
      e.preventDefault();
      e.stopPropagation();
    });

    super({
      ...config,
      hidden: false,
      draggable: false,
      clickable: false,
      width: config.width ?? 960,
      height: config.height ?? 960,
      jdomelem: jdomelem as unknown as JQueryNodeElem,
    });

    this.jdomelem1 = jdomelem1;
    this.jdomelem3 = jdomelem3;
    this.popupContainerDomelem = jdomelem3 as unknown as JQueryNodeElem;
    this.domelem1 = jdomelem1[0];

    const node = this;

    jdomelem.on(
      'click touchend',
      '.ViewTabMenuButton:not(.disabled, .active)',
      function (this: HTMLElement, e: ViewDomEvent) {
        e.stopPropagation();
        e.preventDefault();
        const button = $(this);
        const bgestalt = button.attr('data-button-gestalt') as string | undefined;
        const bdata = button.attr('data-button-data') as string | undefined;
        node.lastButton = button;
        jdomelem.find('.ViewTabMenuButton').removeClass('active');
        button.addClass('active');
        const id = button.attr('data-button-id') as string | undefined;
        node.trigger('button_click.' + (id ?? ''), [bgestalt, bdata]);
      }
    );

    jdomelem.on(
      'click touchend',
      '.Button:not(.disabled, .active)',
      function (this: HTMLElement, e: ViewDomEvent) {
        e.stopPropagation();
        e.preventDefault();
        const button = $(this);
        const bgestalt = button.attr('data-button-gestalt') as string | undefined;
        const bdata = button.attr('data-button-data') as string | undefined;
        node.lastButton = button;
        button.addClass('active');
        const id = button.attr('data-button-id') as string | undefined;
        node.trigger('button_click.' + (id ?? ''), [bgestalt, bdata]);
      }
    );

    // LISTEN TO STATES
    // FIXME: redundant to viewmap code
    node.on('states_active', ((e: ViewDomEvent, value: unknown) => {
      void e;
      if (value) {
        node.FXShow();
        const root = (node.gameNode as unknown as { GameRoot?: GameRootForView } | undefined)
          ?.GameRoot;
        if (node.parentNode) {
          (node.parentNode.jdomelem as unknown as JQueryViewElem).addClass(
            'Active' + (jdomelem.attr('id') as string)
          );
        }
        if (root?.renderMenu) {
          root.renderMenu.jdomelem.find('.mm-tab').removeClass('active');
          root.renderMenu.jdomelem
            .find('.mm-tab[data-button-id=' + node.id + ']')
            .addClass('active');
        }
        node.trigger('viewtab_selected');
      } else {
        if (node.parentNode) {
          (node.parentNode.jdomelem as unknown as JQueryViewElem).removeClass(
            'Active' + (jdomelem.attr('id') as string)
          );
        }
        node.FXHide();
      }
    }) as unknown as (e: ViewDomEvent) => void);
  }

  render(): void {
    if (this.RenderTemplate !== undefined) {
      const html = getApp().renderView(this.RenderTemplate, this);
      this.jdomelem1.html(html);
    }
  }

  override addChild(child: RenderNode, ui_elem?: boolean): RenderNode {
    if (child.hidden) {
      child.hide();
    }
    if (ui_elem) {
      (this.jdomelem as unknown as JQueryViewElem).append(child.domelem);
    } else {
      this.jdomelem1.append(child.domelem);
    }
    child.parentNode = this;
    this.children.add(child);
    child.onAddInit();
    return child;
  }

  lock(): void {
    this.jdomelem3.addClass('lockOn');
  }

  unlock(): void {
    this.jdomelem3.removeClass('lockOn');
  }

  override onAddInit(): void {
    this.render();
    this.draw();
    if (this.hidden) {
      this.hide();
    }
  }

  override css(props: Record<string, string | number>): void {
    this.jdomelem1.css(props);
  }

  FXShow(): void {
    (this.jdomelem as unknown as JQueryViewElem).addClass('active');
  }

  FXHide(): void {
    (this.jdomelem as unknown as JQueryViewElem).removeClass('active');
  }

  /** Legacy stub — body computed dimensions but didn't apply them.
   *  Preserved verbatim. */
  updateScroller(): void {
    const stage = this.parentNode;
    if (!stage) return;
    void stage.width;
    void stage.height;
  }
}

// ── ViewMap ─────────────────────────────────────────────────────────────────

interface GameRootForView {
  renderMenu?: { jdomelem: JQueryViewElem };
  _cancelPendingCenter?: () => void;
}

export type ViewMapConfig = NodeConfig & {
  width?: number;
  height?: number;
  zoomScale?: number;
  background?: string;
};

export class RenderViewMap extends RenderNode {
  jdomelem1: JQueryViewElem;
  jdomelem2: JQueryViewElem;
  jdomelem3: JQueryViewElem;
  domelem1: HTMLElement;
  domelem2: HTMLElement;
  jdomelemZoom: JQueryViewElem;
  _jZoomIn: JQueryViewElem;
  _jZoomOut: JQueryViewElem;
  _jFullscreen: JQueryViewElem;
  zoomScale: number;
  scroller: ScrollerLike | undefined = undefined;
  userPos: { x: number; y: number } | undefined = undefined;
  userScaledPos: { x: number; y: number } | undefined = undefined;
  declare userAbsPos: { x: number; y: number } | undefined;
  _pinchStartDist: number | null | undefined = null;
  _wheelZoomTarget: number | null = null;
  _wheelZoomOrigin: { x: number; y: number } | null = null;
  _wheelZoomRaf = 0;
  _cancelWheelZoom: () => void = () => undefined;

  constructor(config: ViewMapConfig = {}) {
    const $ = getJQuery();
    const jdomelem = $("<div class='ViewMap'></div>");
    const jdomelem1 = $("<div class='ViewMapContainer'></div>");
    const jdomelem2 = $(
      "<img class='ViewMapContainerImg' src='" +
        setup.imagePathPrefix +
        (config.background ?? '') +
        "'>"
    );
    const jdomelemZoom = $(
      '<div class="ZoomControls"><div class="ZoomIn"></div><div class="ZoomOut"></div><div class="Fullscreen"></div></div>'
    );
    const jdomelem3 = $("<div class='PopupContainer'></div>");
    jdomelem1.append(jdomelem2);
    jdomelem.append(jdomelem1);
    jdomelem.append(jdomelem3);
    jdomelem.append(jdomelemZoom);

    jdomelem3.on('mousedown mouseup touchstart touchend dblclick dbltap tap', (e) => {
      e.preventDefault();
      e.stopPropagation();
    });

    super({
      ...config,
      hidden: false,
      draggable: true,
      clickable: true,
      offsetX: 0, // Scroller needs offset 0
      offsetY: 0, // Scroller needs offset 0
      width: config.width ?? 2920,
      height: config.height ?? 2200,
      jdomelem: jdomelem as unknown as JQueryNodeElem,
    });

    this.jdomelem1 = jdomelem1;
    this.jdomelem2 = jdomelem2;
    this.jdomelem3 = jdomelem3;
    this.popupContainerDomelem = jdomelem3 as unknown as JQueryNodeElem;
    this.jdomelemZoom = jdomelemZoom;
    this.domelem1 = jdomelem1[0];
    this.domelem2 = jdomelem2[0];
    this._jZoomIn = jdomelemZoom.find('.ZoomIn');
    this._jZoomOut = jdomelemZoom.find('.ZoomOut');
    this._jFullscreen = jdomelemZoom.find('.Fullscreen');
    this.zoomScale = config.zoomScale ?? 1;

    // LISTEN TO STATES
    this.on('states_active', ((e: ViewDomEvent, value: unknown) => {
      e.stopPropagation();
      const root = (this.gameNode as unknown as { GameRoot?: GameRootForView } | undefined)
        ?.GameRoot;
      if (value) {
        this.FXShow();
        if (this.parentNode) {
          (this.parentNode.jdomelem as unknown as JQueryViewElem).addClass(
            'Active' + (jdomelem.attr('id') as string)
          );
        }
        if (root?.renderMenu) {
          root.renderMenu.jdomelem.find('.mm-tab').removeClass('active');
          root.renderMenu.jdomelem
            .find('.mm-tab[data-button-id=' + this.id + ']')
            .addClass('active');
        }
      } else {
        if (this.parentNode) {
          (this.parentNode.jdomelem as unknown as JQueryViewElem).removeClass(
            'Active' + (jdomelem.attr('id') as string)
          );
        }
        this.FXHide();
      }
    }) as unknown as (e: ViewDomEvent) => void);
  }

  override addChild(child: RenderNode, ui_elem?: boolean): RenderNode {
    if (child.hidden) {
      child.hide();
    }
    if (ui_elem) {
      (this.jdomelem as unknown as JQueryViewElem).append(child.domelem);
    } else {
      this.jdomelem1.append(child.domelem);
    }
    child.parentNode = this;
    this.children.add(child);
    child.dragHandler = child.dragHandler ?? this.dragHandler;
    child.useDragHandler = this.dragHandler;
    child.onAddInit();
    return child;
  }

  lock(): void {
    this.jdomelem3.addClass('lockOn');
  }

  unlock(): void {
    this.jdomelem3.removeClass('lockOn');
  }

  override onAddInit(): void {
    this.setZoomScale(this.zoomScale);
    if (this.draggable) {
      this.initScroller();
    }
    this.updateRenderProp();
    this.dragHandler = new RenderDragHandler();
    this.useDragHandler = this.dragHandler;
    this.draw();
    if (this.hidden) {
      this.hide();
    }
  }

  override css(props: Record<string, string | number>): void {
    this.jdomelem1.css(props);
  }

  override setPosition(pos: { x: number; y: number }): void {
    if (_config.viewMapStopZone) {
      const stopZone = _config.viewMapStopZone;
      const parent = this.parentNode;
      if (parent) {
        const clipx = parent.width - this.getScaledSize().width - stopZone;
        const clipy = parent.height - this.getScaledSize().height - stopZone;
        if (pos.x > stopZone) {
          pos.x = stopZone + (pos.x - stopZone) * (stopZone / pos.x);
        } else if (pos.x < clipx) {
          const clipdiff = pos.x - clipx;
          pos.x = clipx + clipdiff * (stopZone / (stopZone - clipdiff));
        }
        if (pos.y > stopZone) {
          pos.y = stopZone + (pos.y - stopZone) * (stopZone / pos.y);
        } else if (pos.y < clipy) {
          const clipdiff = pos.y - clipy;
          pos.y = clipy + clipdiff * (stopZone / (stopZone - clipdiff));
        }
      }
    }
    pos.x = Math.round(pos.x);
    pos.y = Math.round(pos.y);
    this.x = pos.x;
    this.y = pos.y;
    const style = this.domelem1.style as CSSStyleDeclaration & {
      webkitTransformOriginZ?: string | number;
      webkitTransformOriginX?: string;
      webkitTransformOriginY?: string;
      MozTransformOrigin?: string;
      msTransformOrigin?: string;
    };
    style.webkitTransformOriginZ = 0;
    style.webkitTransformOriginX = pos.x + 'px';
    style.webkitTransformOriginY = pos.y + 'px';
    style.MozTransformOrigin = pos.x + 'px ' + pos.y + 'px';
    style.msTransformOrigin = pos.x + 'px ' + pos.y + 'px';
    this.setTransform({ transX: pos.x + this.offsetX, transY: pos.y + this.offsetY });
  }

  updateScroller(): void {
    const stage = this.parentNode;
    if (!stage || !this.scroller) return;
    const scaleW = stage.width / this.width;
    const scaleH = stage.height / this.height;
    let minZoom = scaleW > scaleH ? scaleW : scaleH;
    if (minZoom > 1) {
      minZoom = 1;
    }
    this.scroller.options.minZoom = minZoom < 0.5 ? 0.5 : minZoom;
    this.scroller.zoomTo(this.zoomScale);
    this.scroller.setDimensions(
      stage.width,
      stage.height,
      this.getSize().width,
      this.getSize().height
    );
    this._updateZoomButtonsState();
  }

  initScroller(): void {
    const initx = this.x;
    const inity = this.y;
    const ScrollerCtor = getScroller();
    const scroller = new ScrollerCtor(
      (left, top, zoom) => {
        if (!scroller.__isDecelerating && !scroller.__isDragging && !scroller.__isAnimating) {
          this.trigger('scrollend', [this]);
        }
        this.setZoomScale(zoom);
        this.setPosition({ x: -left, y: -top });
        this.setTransform({ scaleX: zoom, scaleY: zoom });
      },
      {
        zooming: true,
        locking: false,
        bouncing: false,
        animating: true,
        animationDuration: 300,
        minZoom: 0.5,
        maxZoom: 1,
      }
    );
    this.scroller = scroller;
    scroller.setPosition(0, 0);
    this.updateScroller();
    scroller.scrollTo(-initx, -inity);

    const $ = getJQuery();
    const jq = this.jdomelem as unknown as JQueryViewElem;
    jq.on('dblclick', '.ZoomControls', (e) => {
      e.stopPropagation();
    });
    jq.on('click touchend', '.ZoomControls .ZoomOut', (e) => {
      e.stopPropagation();
      this._cancelWheelZoom();
      this.zoomOut();
    });
    jq.on('click touchend', '.ZoomControls .ZoomIn', (e) => {
      e.stopPropagation();
      this._cancelWheelZoom();
      this.zoomIn();
    });
    jq.on('click touchend', '.ZoomControls .Fullscreen', (e) => {
      e.stopPropagation();
      this._cancelWheelZoom();
      getApp().game?.resetZoom?.();
    });

    this.on('dblclick', (e) => {
      e.stopPropagation();
      this._cancelWheelZoom();
      const userAbsPos = this.userAbsPos;
      if (!userAbsPos) return;
      // Same animating-toggle anti-pattern as zoomIn/zoomOut: don't flip
      // it back to false synchronously, the scroller animation reads the
      // flag every frame.
      if (this.zoomScale !== 1) {
        scroller.zoomTo(1, true, userAbsPos.x, userAbsPos.y);
      } else {
        scroller.zoomTo(scroller.options.minZoom ?? 0.5, true, userAbsPos.x, userAbsPos.y);
      }
    });

    this.on('mousedown', (e) => {
      e.preventDefault();
      const parent = this.parentNode;
      if (!parent) return;
      const offset = (this.jdomelem as unknown as JQueryViewElem).offset();
      const parentOffset = (parent.jdomelem as unknown as JQueryViewElem).offset();
      const pageX = e.pageX ?? 0;
      const pageY = e.pageY ?? 0;
      const dragScale = this.dragHandler?.scale ?? 1;
      this.userPos = { x: pageX - offset.left, y: pageY - offset.top };
      this.userScaledPos = {
        x: (pageX - offset.left) * dragScale,
        y: (pageY - offset.top) * dragScale,
      };
      this.userAbsPos = { x: pageX - parentOffset.left, y: pageY - parentOffset.top };

      this.dragging = true;
      scroller.doTouchStart([{ pageX, pageY }], e.timeStamp);
    });

    if (this.useDragHandler) {
      this.useDragHandler.on('mousemove', (e) => {
        if (this.dragging) {
          scroller.doTouchMove([{ pageX: e.pageX ?? 0, pageY: e.pageY ?? 0 }], e.timeStamp);
        }
      });
      this.useDragHandler.on('mouseup', (e) => {
        this.dragging = false;
        scroller.doTouchEnd(e.timeStamp);
      });
    }

    this.domelem.addEventListener(
      'touchstart',
      (e) => {
        const touchEvt = e as TouchEvent;
        if (
          touchEvt.touches[0]?.target instanceof HTMLElement &&
          /input|textarea|select/i.test(touchEvt.touches[0].target.tagName)
        ) {
          return;
        }
        const touch = touchEvt.touches[0];
        const parent = this.parentNode;
        if (!touch || !parent) return;
        const parentOffset = (parent.jdomelem as unknown as JQueryViewElem).offset();
        this.userAbsPos = {
          x: touch.pageX - parentOffset.left,
          y: touch.pageY - parentOffset.top,
        };
        if (touchEvt.touches.length === 2) {
          const t0 = touchEvt.touches[0];
          const t1 = touchEvt.touches[1];
          if (t0 && t1) {
            const dx = t0.pageX - t1.pageX;
            const dy = t0.pageY - t1.pageY;
            this._pinchStartDist = Math.sqrt(dx * dx + dy * dy) || null;
          }
        } else {
          this._pinchStartDist = null;
        }
        scroller.doTouchStart(
          touchEvt.touches as unknown as ArrayLike<{
            pageX: number;
            pageY: number;
          }>,
          touchEvt.timeStamp
        );
        e.preventDefault();
      },
      { passive: false }
    );

    if (this.useDragHandler) {
      const dragDom = this.useDragHandler.domelem as Window;
      dragDom.addEventListener(
        'touchmove',
        (e) => {
          const touchEvt = e as TouchEvent & { scale?: number };
          let scale = touchEvt.scale;
          if (scale == null && touchEvt.touches.length === 2) {
            const t0 = touchEvt.touches[0];
            const t1 = touchEvt.touches[1];
            if (t0 && t1) {
              const dx = t0.pageX - t1.pageX;
              const dy = t0.pageY - t1.pageY;
              const dist = Math.sqrt(dx * dx + dy * dy);
              if (this._pinchStartDist) {
                scale = dist / this._pinchStartDist;
              }
            }
          }
          scroller.doTouchMove(
            touchEvt.touches as unknown as ArrayLike<{ pageX: number; pageY: number }>,
            touchEvt.timeStamp,
            scale
          );
          e.preventDefault();
        },
        { passive: false }
      );
      dragDom.addEventListener(
        'touchend',
        (e) => {
          scroller.doTouchEnd((e as TouchEvent).timeStamp);
        },
        false
      );
      dragDom.addEventListener(
        'touchcancel',
        (e) => {
          scroller.doTouchEnd((e as TouchEvent).timeStamp);
        },
        false
      );
    }

    void $; // referenced inside delegated handlers via getJQuery() above.

    // Mouse-wheel zoom: continuous and smoothly tweened.
    this._wheelZoomTarget = null;
    this._wheelZoomOrigin = null;
    this._cancelWheelZoom = (): void => {
      this._wheelZoomTarget = null;
      if (this._wheelZoomRaf) {
        cancelAnimationFrame(this._wheelZoomRaf);
        this._wheelZoomRaf = 0;
      }
    };
    const stepTowardTarget = (): void => {
      this._wheelZoomRaf = 0;
      const target = this._wheelZoomTarget;
      const origin = this._wheelZoomOrigin;
      if (target == null || !origin) return;
      const current = scroller.__zoomLevel ?? this.zoomScale ?? 1;
      let next = current + (target - current) * 0.25;
      if (Math.abs(target - next) < 0.001) {
        next = target;
        this._wheelZoomTarget = null;
      }
      scroller.zoomTo(next, false, origin.x, origin.y);
      if (this._wheelZoomTarget != null) {
        this._wheelZoomRaf = requestAnimationFrame(stepTowardTarget);
      }
    };
    this.domelem.addEventListener(
      'wheel',
      (e) => {
        const wheelEvt = e as WheelEvent;
        wheelEvt.preventDefault();
        const offset = (this.jdomelem as unknown as JQueryViewElem).offset();
        const unit = wheelEvt.deltaMode === 1 ? 16 : wheelEvt.deltaMode === 2 ? 400 : 1;
        const delta = Math.max(-400, Math.min(400, wheelEvt.deltaY * unit));
        const factor = 0.999 ** delta;
        const opts = scroller.options;
        const base =
          this._wheelZoomTarget != null
            ? this._wheelZoomTarget
            : (scroller.__zoomLevel ?? this.zoomScale ?? 1);
        const minZ = opts.minZoom ?? 0.5;
        const maxZ = opts.maxZoom ?? 1;
        const target = Math.max(minZ, Math.min(maxZ, base * factor));
        this._wheelZoomTarget = target;
        this._wheelZoomOrigin = {
          x: wheelEvt.pageX - offset.left,
          y: wheelEvt.pageY - offset.top,
        };
        if (!this._wheelZoomRaf) {
          this._wheelZoomRaf = requestAnimationFrame(stepTowardTarget);
        }
      },
      { passive: false }
    );
  }

  scrollTo(pos: { x: number; y: number }, dur?: number): void {
    if (!this.parentNode || !this.scroller) return;
    const vpCenter = this.parentNode.getCenterPosition();
    const duration = dur !== undefined ? dur : 300;
    const root = (this.gameNode as unknown as { GameRoot?: GameRootForView } | undefined)?.GameRoot;
    root?._cancelPendingCenter?.();
    this.scroller.options.animating = duration > 0;
    this.scroller.options.animationDuration = duration;
    this.scroller.scrollTo(pos.x - vpCenter.x, pos.y - vpCenter.y, true);
    this.scroller.options.animating = false;
    this.scroller.options.animationDuration = 300;
  }

  setZoomScale(scale: number): void {
    this.zoomScale = scale;
    if (this.dragHandler) this.dragHandler.scale = 1 / scale;
    const jq = this.jdomelem as unknown as JQueryViewElem;
    if (scale < 0.75) {
      jq.addClass('zoomHide2');
    } else {
      jq.removeClass('zoomHide2');
    }
    if (scale < 1) {
      jq.addClass('zoomHide1');
    } else {
      jq.removeClass('zoomHide1');
    }
    this._updateZoomButtonsState();
  }

  _updateZoomButtonsState(): void {
    if (!this._jZoomIn) return;
    const maxZoom = this.scroller?.options?.maxZoom ?? 1;
    const minZoom = this.scroller?.options?.minZoom ?? 0.5;
    const atMax = this.zoomScale >= maxZoom - 0.001;
    const atMin = this.zoomScale <= minZoom + 0.001;
    this._jZoomIn.toggleClass('disabled', atMax);
    this._jZoomOut.toggleClass('disabled', atMin);
    this._jFullscreen.toggleClass('disabled', atMin && atMax);
  }

  zoomIn(): void {
    const zoomTo = this.zoomScale + 0.25 > 1 ? 1 : this.zoomScale + 0.25;
    if (zoomTo === this.zoomScale) return;
    this.scroller?.zoomTo(zoomTo, true);
  }

  zoomOut(): void {
    const zoomTo = this.zoomScale - 0.25 < 0.5 ? 0.5 : this.zoomScale - 0.25;
    if (zoomTo === this.zoomScale) return;
    this.scroller?.zoomTo(zoomTo, true);
  }

  FXShow(): void {
    (this.jdomelem as unknown as JQueryViewElem).addClass('active');
  }

  FXHide(): void {
    (this.jdomelem as unknown as JQueryViewElem).removeClass('active');
  }
}

// ── Stage ───────────────────────────────────────────────────────────────────

export type StageConfig = NodeConfig & {
  width?: number;
  height?: number;
  offsetX?: number;
  offsetY?: number;
};

export class RenderStage extends RenderNode {
  jdomelem2: JQueryViewElem;
  declare userAbsPos: { x: number; y: number } | undefined;

  constructor(config: StageConfig = {}) {
    const $ = getJQuery();
    // Respect a subclass-supplied jdomelem (e.g. MainMenu's
    // `<div class='MainMenu'>` wrapper).  Same pattern as the
    // PR #221 jdomelem-clobber fix in RenderSprite/RenderText.
    const jdomelem =
      (config.jdomelem as unknown as JQueryViewElem | undefined) ?? $("<div class='Stage'></div>");
    const jdomelem2 = $("<div class='PopupContainer Top NoClose'></div>");
    jdomelem.append(jdomelem2);

    super({
      ...config,
      x: 0,
      y: 0,
      offsetX: config.offsetX ?? 0,
      offsetY: config.offsetY ?? 0,
      width: config.width ?? 960,
      height: config.height ?? 600,
      position: 'relative',
      jdomelem: jdomelem as unknown as JQueryNodeElem,
    });

    this.jdomelem2 = jdomelem2;
    this.popupContainerDomelem = jdomelem2 as unknown as JQueryNodeElem;
    this.dragHandler = new RenderDragHandler();
    this.useDragHandler = this.dragHandler;
    this.initUI();
    this.onAddInit();
  }

  initUI(): void {
    this.on('mousemove', (e) => {
      const pageX = (e as ViewDomEvent).pageX ?? 0;
      const pageY = (e as ViewDomEvent).pageY ?? 0;
      const offset = (this.jdomelem as unknown as JQueryViewElem).offset();
      this.userAbsPos = { x: pageX - offset.left, y: pageY - offset.top };
    });
    this.on('mousedown touchstart', (e) => {
      // FIX for FF accidential selection getting stuck
      document.getSelection()?.removeAllRanges();
      const pageX = (e as ViewDomEvent).pageX ?? 0;
      const pageY = (e as ViewDomEvent).pageY ?? 0;
      const offset = (this.jdomelem as unknown as JQueryViewElem).offset();
      this.userClickAbsPos = { x: pageX - offset.left, y: pageY - offset.top };
    });
  }

  lock(): void {
    this.jdomelem2.addClass('lockOn');
  }

  unlock(): void {
    this.jdomelem2.removeClass('lockOn');
  }

  override setSize(size: { width?: number; height?: number }): void {
    this.setAttrs(size as Record<string, unknown>);
    this.css({
      width: this.width + 'px',
      height: this.height + 'px',
    });
    this.children.each((node) => {
      const childMap = node as unknown as { scroller?: unknown; updateScroller?: () => void };
      if (childMap.scroller && typeof childMap.updateScroller === 'function') {
        childMap.updateScroller();
      }
    });
  }
}

// ── MainMenu ────────────────────────────────────────────────────────────────

export interface MainMenuButton {
  label: string;
  id: string;
  states?: Record<string, boolean>;
}

export interface MainMenuData {
  buttons: MainMenuButton[];
  logo?: SpriteHelperConfig | string;
}

export type MainMenuConfig = StageConfig & {
  data?: MainMenuData;
};

interface XPSnapshot {
  active: number;
  barsize: number;
  val: number;
  level: number;
}

interface StatusbarLikeForXP {
  XP_active: number;
  XP_barsize: number;
  XP_val: number;
  XP_level: number;
  gameNode?: { GameRoot?: { xp_level?: { xp_min?: number; xp_max?: number } } };
}

export class RenderMainMenu extends RenderStage {
  data: MainMenuData;
  declare template: string;
  _xpSlot: HTMLElement | null = null;
  _xpLast: XPSnapshot | null = null;

  static {
    RenderMainMenu.prototype.template = 'mainmenu.html';
  }

  constructor(config: MainMenuConfig = {}) {
    const $ = getJQuery();
    const jdomelem = $("<div class='MainMenu'></div>");

    super({
      ...config,
      width: config.width ?? 960,
      height: config.height ?? 48,
      z: 1000,
      position: 'relative',
      jdomelem: jdomelem as unknown as JQueryNodeElem,
    });

    this.data = config.data ?? { buttons: [] };
    if (this.data.logo && typeof this.data.logo !== 'string') {
      this.data.logo = renderSpriteHtml(this.data.logo);
    }

    this.setSize(this.getSize());
    this.updateRenderProp();
    this.render();

    // Setup Button Events
    const root = (this.gameNode as unknown as { GameRoot?: GameRootForMain } | undefined)?.GameRoot;

    (this.jdomelem as unknown as JQueryViewElem).on(
      'click touchend',
      '#LocaleToggle:not(.disabled)',
      (e) => {
        e.stopPropagation();
        e.preventDefault();
        root?.trigger?.('toggle_locale');
      }
    );
    (this.jdomelem as unknown as JQueryViewElem).on(
      'click touchend',
      '#UserData:not(.disabled)',
      (e) => {
        e.stopPropagation();
        e.preventDefault();
        root?.trigger?.('user_data');
      }
    );
    (this.jdomelem as unknown as JQueryViewElem).on(
      'click touchend',
      '.mm-tab:not(.disabled)',
      function (this: HTMLElement, e: ViewDomEvent) {
        e.stopPropagation();
        e.preventDefault();
        const buttonId = $(this).attr('data-button-id') as string | undefined;
        root?.trigger?.('switch_view', [buttonId]);
      }
    );

    // Forward .mm-xp taps to the same `click_status.XP` event.
    (this.jdomelem as unknown as JQueryViewElem).on(
      'click touchend',
      '.mm-xp .StatusItem',
      function (this: HTMLElement, e: ViewDomEvent) {
        e.stopPropagation();
        e.preventDefault();
        const statusid = $(this).attr('data-status-id') as string | undefined;
        if (statusid) root?.trigger?.('click_status.' + statusid);
      }
    );
  }

  // Don't pin height/display inline — let CSS drive them.  Desktop
  // sets a fixed 48 px height with `display: block`; the mobile
  // breakpoints switch to a flex column that grows to fit the
  // two-row content.  Width still goes inline because the desktop
  // layout uses a 960 px design width that JS scales for narrower
  // viewports.
  override setSize(size: { width?: number; height?: number }): void {
    this.setAttrs(size as Record<string, unknown>);
    this.css({ width: this.width + 'px' });
  }

  override updateRenderProp(): void {
    this.css({
      'z-index': this.z,
      position: this.position,
      top: 0,
      left: 0,
    });
  }

  render(): void {
    const html = getApp().renderView(this.template, this.data);
    (this.jdomelem as unknown as JQueryViewElem).html(html);
    // Invalidate the in-place XP cache so the next renderXP repopulates
    // the freshly-emptied .mm-xp-bar slot instead of memo-skipping.
    this._xpSlot = null;
    this._xpLast = null;
  }

  // Update the cloned XP bar in-place — 30 fps Statusbar ticks during
  // XP animations would otherwise tear down + reinsert DOM each frame
  // and interrupt any in-flight CSS transition on .StatusGraph width.
  // Memoised against the last write so unchanged data is a no-op.
  // `sb` is the Statusbar instance; read its scalars directly to avoid
  // allocating a payload object per tick.
  renderXP(sb: StatusbarLikeForXP): void {
    if (!this.jdomelem || !sb) return;
    const prev = this._xpLast;
    if (
      prev &&
      prev.active === sb.XP_active &&
      prev.barsize === sb.XP_barsize &&
      prev.val === sb.XP_val &&
      prev.level === sb.XP_level
    ) {
      return;
    }
    this._xpLast = {
      active: sb.XP_active,
      barsize: sb.XP_barsize,
      val: sb.XP_val,
      level: sb.XP_level,
    };
    if (!this._xpSlot) {
      const slot = (this.jdomelem as unknown as JQueryViewElem).find('.mm-xp-bar') as unknown as {
        0?: HTMLElement;
      };
      this._xpSlot = slot[0] ?? null;
      if (!this._xpSlot) return;
    }
    const item = this._xpSlot.querySelector('.StatusItem.XP');
    if (!item) {
      this._xpSlot.innerHTML = getApp().renderView('xp_bar.html', {
        XP_active: sb.XP_active,
        XP_barsize: sb.XP_barsize,
        XP_val: sb.XP_val,
        XP_level: sb.XP_level,
      });
      return;
    }
    const lvl = sb.gameNode?.GameRoot?.xp_level ?? {};
    const xpMin = lvl.xp_min ?? 0;
    const current = Math.max(0, Math.round((sb.XP_val ?? 0) - xpMin));
    const total = Math.max(1, (lvl.xp_max ?? 0) - xpMin);
    const graph = item.querySelector('.StatusGraph') as HTMLElement | null;
    const text = item.querySelector('.StatusText');
    const level = item.querySelector('.StatusTextLevel');
    if (graph) graph.style.width = sb.XP_barsize + 'px';
    if (text) text.textContent = current + '/' + total;
    if (level) level.textContent = String(sb.XP_level);
    item.classList.toggle('active', sb.XP_active > 0.2);
  }

  override lock(): void {
    const jq = this.jdomelem as unknown as JQueryViewElem;
    jq.addClass('locked');
    jq.find('.mm-user-btn, .mm-tab').addClass('disabled');
  }

  override unlock(): void {
    const jq = this.jdomelem as unknown as JQueryViewElem;
    jq.removeClass('locked');
    jq.find('.mm-user-btn, .mm-tab').removeClass('disabled');
  }

  addButton(text: string, id: string, states?: Record<string, boolean>): void {
    const button: MainMenuButton =
      states !== undefined ? { label: text, id, states } : { label: text, id };
    this.data.buttons.push(button);
    this.render();
  }
}

interface GameRootForMain {
  trigger?(ev: string, params?: unknown[]): void;
}
