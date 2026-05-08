// Render-side `Node` base class — the foundation that every render
// primitive (Sprite, Circle, Text, Perp, Decorator, Cable, Popup,
// Statusbar, ViewMap, …) extends via util.extend.  Owns positioning,
// transforms, opacity, the DOM/jQuery wrapper, the children/decorators
// collections, and the click/drag wiring.
//
// Extracted from scripts/Render.js's IIFE in PR 31 of issue #147.
// PR 40 lands the `_instances` / `_ids` registry in
// scripts/render/renderRegistry.ts and retires the
// `setRenderNodeRegistry` injection seam this file used to own.  The
// `setRenderNodeTickers` injection seam retired alongside the
// extraction of `renderCreatejsTicker.ts` and direct
// `RenderSlowTicker` import.

import { OrderedSet } from '../game/OrderedSet.js';
import { RenderSet } from './RenderSet.js';
import { RenderSlowTicker } from './RenderSlowTicker.js';
import { type JQueryRenderElem, type JQueryRenderEvent, getRenderJQuery } from './_jqueryShim.js';
import { tickerRemoveListener } from './renderCreatejsTicker.js';
import { nodeCount, registerNode, unregisterNode } from './renderRegistry.js';

// ── DOM / jQuery surface that Node touches ──────────────────────────────────
//
// `JQueryNodeElem` is re-exported as a type alias to the shared
// `JQueryRenderElem` so existing config-type imports
// (`NodeConfig.jdomelem: JQueryNodeElem`) and the cross-module
// boundary type stay stable while the underlying surface
// consolidates.  See scripts/render/_jqueryShim.ts.

export type JQueryNodeElem = JQueryRenderElem;
type NodeDomEvent = JQueryRenderEvent;

// ── structural surfaces for cross-class fields ──────────────────────────────

// Structural surface RenderNode needs from the drag handler.  Kept
// loose (`scale: number; domelem: Window`) so RenderViews / RenderPerp
// can assign a real `RenderDragHandler` instance without dragging
// the full implementation type into RenderNode's import graph
// (RenderDragHandler doesn't import RenderNode, so this is purely
// to keep the TS variance check happy when callers narrow further).
interface DragHandlerLike {
  scale: number;
  domelem: Window;
  collisionNodes: OrderedSet<{ getPosition(): { x: number; y: number } }>;
  addListener(node: RenderNode): void;
  on(ev: string, fn: (e: NodeDomEvent, ...args: unknown[]) => void): void;
  off(ev: string): void;
  trigger(ev: string, params?: unknown[]): void;
  dragstart(e: NodeDomEvent): void;
  getCollisionPos(
    node: RenderNode,
    newPos: { x: number; y: number }
  ): { x: number; y: number; coll: boolean };
  testCollisions(node: RenderNode, newPos: { x: number; y: number }): boolean;
}

interface CableLike {
  length: number;
  cableMaxLength: number;
  perpFrom: RenderNode;
  perpTo: RenderNode;
}

interface GameNodeLike {
  trigger(ev: string, params?: unknown[]): void;
  parentNode?: { renderNode: RenderNode };
}

// ── config / setAttrs ───────────────────────────────────────────────────────

export type NodeConfig = {
  id?: string;
  jdomelem?: JQueryNodeElem;
  domelem?: HTMLElement;
} & Record<string, unknown>;

// ── the class ───────────────────────────────────────────────────────────────

export class RenderNode {
  // Per-instance fields, assigned in constructor / init.
  _id!: number;
  id!: string;
  jdomelem!: JQueryNodeElem;
  domelem!: HTMLElement;
  children!: RenderSet<RenderNode>;
  decorators!: RenderSet<RenderNode>;

  // Defaults live on the prototype (see static-init block below) so that
  // legacy function-constructor subclasses extended via util.extend pick
  // them up through the prototype chain even when they don't call into
  // RenderNode's constructor.  `declare` keeps TS aware of the shape
  // without emitting per-instance initialisers that would shadow the
  // prototype defaults.
  declare x: number;
  declare y: number;
  declare z: number;
  declare position: string;
  declare width: number;
  declare height: number;
  declare opacity: number;
  declare offsetX: number;
  declare offsetY: number;
  declare transX: number;
  declare transY: number;
  declare scaleX: number;
  declare scaleY: number;
  declare rotate: number;
  declare hidden: boolean;
  declare display: string;
  declare clickable: boolean;
  declare draggable: boolean;
  declare dragging: boolean;
  declare sticky: boolean;
  declare extendClass: string | undefined;

  // Optional links set by addChild / addDecorator / addPopup or by
  // subclasses.  Declared as `T | undefined` (rather than optional
  // `T?`) so that legacy assignments such as `child.useDragHandler =
  // this.dragHandler` survive `exactOptionalPropertyTypes` even when
  // the right-hand side is itself undefined.  `declare` keeps the
  // declarations type-only — legacy `extend()` subclasses don't pass
  // through RenderNode's constructor, so emitting per-instance
  // initialisers would just shadow the prototype-chain lookup.
  declare parentNode: RenderNode | undefined;
  declare decoratedNode: RenderNode | undefined;
  declare dragHandler: DragHandlerLike | undefined;
  declare useDragHandler: DragHandlerLike | undefined;
  declare popupContainerDomelem: JQueryNodeElem | undefined;
  declare gameNode: GameNodeLike | undefined;
  declare perpTo: { cables: RenderSet<RenderNode> } | undefined;
  declare perpFrom: { cables: RenderSet<RenderNode> } | undefined;
  declare cables: (RenderSet<RenderNode> & { set: CableLike[] }) | undefined;
  declare detectCollisions: boolean | undefined;
  declare decoType: string | undefined;
  declare dragBound: ((pos: { x: number; y: number }) => void) | undefined;
  declare dragStartPos: { x: number; y: number } | undefined;

  // setDraggable / setClickable timer state.
  declare dragDelay: number | undefined;
  declare cancelClick: boolean | undefined;
  declare cancelClickTimeout: number | undefined;

  static {
    const p = RenderNode.prototype;
    p.x = 0;
    p.y = 0;
    p.z = 0;
    p.position = 'absolute';
    p.width = 0;
    p.height = 0;
    p.opacity = 1;
    p.offsetX = 0;
    p.offsetY = 0;
    p.transX = 0;
    p.transY = 0;
    p.scaleX = 1;
    p.scaleY = 1;
    p.rotate = 0;
    p.hidden = false;
    p.display = 'block';
    p.clickable = false;
    p.draggable = false;
    p.dragging = false;
    p.sticky = false;
    p.extendClass = undefined;
  }

  constructor(config?: NodeConfig) {
    const cfg: NodeConfig = config ?? {};
    if (cfg.jdomelem) {
      this.jdomelem = cfg.jdomelem;
    } else {
      this.jdomelem = getRenderJQuery('RenderNode')("<div class='Node'></div>");
    }
    this.domelem = cfg.domelem ?? this.jdomelem[0];
    this.init(cfg);
  }

  init(config?: NodeConfig): void {
    const cfg: NodeConfig = config ?? {};
    this._id = nodeCount();
    this.id = (cfg.id as string | undefined) ?? 'Node' + this._id;
    registerNode(this);

    this.children = new RenderSet<RenderNode>();
    this.decorators = new RenderSet<RenderNode>();

    this.setAttrs(cfg);
    if (!this.jdomelem) {
      this.jdomelem = getRenderJQuery('RenderNode')(this.domelem);
    }
    this.jdomelem.attr('id', this.id);
    this.updateClass();
  }

  setAttrs(attrs: Record<string, unknown>): void {
    const target = this as unknown as Record<string, unknown>;
    for (const key in attrs) {
      if (Object.prototype.hasOwnProperty.call(attrs, key)) {
        target[key] = attrs[key];
      }
    }
  }

  onAddInit(): void {
    if (this.draggable) {
      this.setDraggable(true);
    }
    if (this.clickable) {
      this.setClickable(true);
    }
    this.updateRenderProp();
    this.draw();
  }

  remove(): void {
    tickerRemoveListener(this);
    RenderSlowTicker.removeListener(this);
    if (this.decoratedNode) {
      this.decoratedNode.decorators.remove(this);
    }
    if (this.parentNode) {
      this.parentNode.children.remove(this);
    }
    if (this.children) {
      this.children.removeAll();
    }
    if (this.cables) {
      this.cables.removeAll();
    }
    if (this.decorators) {
      this.decorators.removeAll();
    }
    if (this.perpTo) {
      this.perpTo.cables.remove(this);
    }
    if (this.perpFrom) {
      this.perpFrom.cables.remove(this);
    }
    this.jdomelem.remove();
    unregisterNode(this._id);
  }

  addChild(child: RenderNode): RenderNode {
    if (child.hidden) {
      child.hide();
    }
    this.jdomelem.append(child.domelem);
    child.parentNode = this;
    this.children.add(child);
    child.dragHandler = child.dragHandler ?? this.dragHandler;
    child.useDragHandler = this.dragHandler;
    child.onAddInit();
    return child;
  }

  addPopup(popup: RenderNode): RenderNode | undefined {
    if (!this.popupContainerDomelem) {
      return undefined;
    }
    this.popupContainerDomelem.empty();
    this.popupContainerDomelem.append(popup.jdomelem);
    popup.parentNode = this;
    this.children.add(popup);
    popup.dragHandler = popup.dragHandler ?? this.dragHandler;
    popup.useDragHandler = this.dragHandler;
    popup.onAddInit();
    return popup;
  }

  addDecorator(deco: RenderNode): RenderNode | string {
    if (!this.parentNode) {
      return 'Could not decorate';
    }
    this.decorators.add(deco);
    if (deco.decoType) {
      const slot = (this as unknown as Record<string, RenderNode | undefined>)[deco.decoType];
      if (slot) {
        slot.remove();
      }
      (this as unknown as Record<string, RenderNode>)[deco.decoType] = deco;
    }
    deco.decoratedNode = this;
    this.parentNode.addChild(deco);
    return deco;
  }

  removeChild(node: RenderNode): void {
    this.children.remove(node);
  }

  getPosition(): { x: number; y: number } {
    return { x: this.x, y: this.y };
  }

  getTopLeftPosition(): { x: number; y: number } {
    const pos = this.getPosition();
    const off = this.getOffset();
    return { x: pos.x - off.x, y: pos.y - off.y };
  }

  getTopRightPosition(): { x: number; y: number } {
    const pos = this.getPosition();
    const off = this.getOffset();
    return { x: pos.x + this.width - off.x, y: pos.y - off.y };
  }

  setPosition(pos: { x: number; y: number }): void {
    if (this.dragBound) {
      this.dragBound(pos);
    }
    const transOffset = {
      x: this.getSize().width / 2 - this.offsetX,
      y: this.getSize().height / 2 - this.offsetY,
    };
    pos.x = Math.round(pos.x);
    pos.y = Math.round(pos.y);
    const style = this.domelem.style as CSSStyleDeclaration & {
      webkitTransformOriginZ?: string | number;
      webkitTransformOriginX?: string;
      webkitTransformOriginY?: string;
      MozTransformOrigin?: string;
      msTransformOrigin?: string;
    };
    style.webkitTransformOriginZ = 0;
    // FIXME: Unsure if working correctly, test offset calculation
    style.webkitTransformOriginX = pos.x - transOffset.x + 'px';
    style.webkitTransformOriginY = pos.y - transOffset.y + 'px';
    // Fix for Mozilla offset:
    style.MozTransformOrigin = pos.x + 'px ' + pos.y + 'px';
    style.msTransformOrigin = pos.x + 'px ' + pos.y + 'px';

    this.setTransform({ transX: pos.x - this.offsetX, transY: pos.y - this.offsetY });
    this.x = pos.x;
    this.y = pos.y;
  }

  setOffset(offset: { x: number; y: number }): void {
    this.offsetX = offset.x;
    this.offsetY = offset.y;
    this.setPosition(this.getPosition());
  }

  getOffset(): { x: number; y: number } {
    return { x: this.offsetX, y: this.offsetY };
  }

  getCenterPosition(): { x: number; y: number } {
    return {
      x: this.x + this.getSize().width / 2,
      y: this.y + this.getSize().height / 2,
    };
  }

  getScaledPosition(): { x: number; y: number } {
    return {
      x: this.x + this.getScaledSize().width / 2,
      y: this.y + this.getScaledSize().height / 2,
    };
  }

  moveTo(pos: { x: number; y: number }): void {
    this.setPosition(pos);
  }

  moveBy(vector: { x: number; y: number }): void {
    this.moveTo({
      x: this.getPosition().x + vector.x,
      y: this.getPosition().y + vector.y,
    });
  }

  clipCablePos(newPos: { x: number; y: number }): { x: number; y: number } {
    if (!this.cables || this.cables.set.length === 0) {
      return newPos;
    }
    let cablecheck = false;
    for (let n = 0; n < this.cables.set.length; n++) {
      const cable = this.cables.set[n];
      if (cable && cable.length > cable.cableMaxLength - 10) {
        cablecheck = true;
        break;
      }
    }
    const dragBoundFunc = (
      pos: { x: number; y: number },
      otherPos: { x: number; y: number },
      cableMaxLength: number
    ): { x: number; y: number } => {
      const circle = { x: otherPos.x, y: otherPos.y, r: cableMaxLength };
      const scale = circle.r / Math.sqrt((pos.x - circle.x) ** 2 + (pos.y - circle.y) ** 2);
      if (scale < 1) {
        return {
          y: Math.round((pos.y - circle.y) * scale + circle.y),
          x: Math.round((pos.x - circle.x) * scale + circle.x),
        };
      }
      return pos;
    };
    if (cablecheck) {
      let result = newPos;
      for (const cable of this.cables.set) {
        const otherperp = cable.perpFrom === this ? cable.perpTo : cable.perpFrom;
        const otherPos = otherperp.getPosition();
        result = dragBoundFunc(result, otherPos, cable.cableMaxLength);
      }
      return result;
    }
    return newPos;
  }

  testParentRadius(newPos: { x: number; y: number }, radius?: number): { x: number; y: number } {
    const r = radius ?? 400;
    const otherperp = this.gameNode?.parentNode?.renderNode;
    if (!otherperp) return newPos;
    const dragBoundFunc = (pos: { x: number; y: number }): { x: number; y: number } => {
      const circle = {
        x: otherperp.getPosition().x,
        y: otherperp.getPosition().y,
        r,
      };
      const scale = circle.r / Math.sqrt((pos.x - circle.x) ** 2 + (pos.y - circle.y) ** 2);
      if (scale < 1) {
        return {
          y: Math.round((pos.y - circle.y) * scale + circle.y),
          x: Math.round((pos.x - circle.x) * scale + circle.x),
        };
      }
      return pos;
    };
    const clipPos = dragBoundFunc(newPos);
    newPos.x = clipPos.x;
    newPos.y = clipPos.y;
    return newPos;
  }

  hide(): void {
    this.css({ display: 'none' });
    this.hidden = true;
    if (this.decorators) {
      this.decorators.hide();
    }
  }

  show(): void {
    this.css({ display: this.display });
    this.hidden = false;
    if (this.decorators) {
      this.decorators.show();
    }
  }

  css(props: Record<string, string | number>): void {
    this.jdomelem.css(props);
  }

  updateClass(): void {
    if (this.extendClass) {
      this.jdomelem.addClass(this.extendClass);
    }
  }

  updateRenderProp(): void {
    this.css({
      'z-index': this.z,
      position: this.position,
      top: 0,
      left: 0,
      display: this.display,
    });
  }

  setZ(z: number): void {
    this.z = z;
    this.css({ 'z-index': this.z });
  }

  setOpacity(opacity: number): void {
    this.opacity = opacity;
    this.css({ opacity });
  }

  setTransform(transf: {
    scaleX?: number;
    scaleY?: number;
    transX?: number;
    transY?: number;
    rotate?: number;
  }): void {
    this.setAttrs(transf as Record<string, unknown>);
    const transform =
      'rotateZ(' +
      this.rotate +
      'deg) scale3d(' +
      this.scaleX +
      ',' +
      this.scaleY +
      ',1) translate3d(' +
      this.transX +
      'px,' +
      this.transY +
      'px,0px)';
    this.css({
      '-webkit-transform-style': 'preserve-3d',
      '-webkit-backface-visibility': 'hidden',
      '-moz-transform-style': 'preserve-3d',
      '-webkit-transform': transform,
      '-moz-transform': transform,
      '-transform': transform,
    });
  }

  getTransform(): {
    scaleX: number;
    scaleY: number;
    transX: number;
    transY: number;
    rotate: number;
  } {
    return {
      scaleX: this.scaleX,
      scaleY: this.scaleY,
      transX: this.transX,
      transY: this.transY,
      rotate: this.rotate,
    };
  }

  setSize(size: { width?: number; height?: number }): void {
    this.setAttrs(size as Record<string, unknown>);
    this.css({
      width: this.width + 'px',
      height: this.height + 'px',
    });
  }

  getSize(): { width: number; height: number } {
    return { width: this.width, height: this.height };
  }

  getScaledSize(): { width: number; height: number } {
    return { width: this.width * this.scaleX, height: this.height * this.scaleY };
  }

  getVectorTo(node2: RenderNode): { x: number; y: number } {
    return {
      x: node2.getPosition().x - this.getPosition().x,
      y: node2.getPosition().y - this.getPosition().y,
    };
  }

  getVectorPos(vector: { x: number; y: number }, scale?: number): { x: number; y: number } {
    const s = scale ?? 1;
    return {
      x: this.getPosition().x + vector.x * s,
      y: this.getPosition().y + vector.y * s,
    };
  }

  draw(): void {
    this.setSize(this.getSize());
    this.setTransform(this.getTransform());
    this.setPosition(this.getPosition());
    this.setOpacity(this.opacity);
  }

  tick(): void {
    this.draw();
  }

  on(event: string, func: (e: NodeDomEvent, ...args: unknown[]) => void): void {
    this.jdomelem.on(event, func);
  }

  trigger(event: string, params?: unknown[]): void {
    if (this.gameNode) {
      this.gameNode.trigger(event, params);
    }
    this.jdomelem.trigger(event, params);
  }

  off(event: string): void {
    this.jdomelem.off(event);
  }

  // TODO: wrap dragevents and add to seperate mousedown touchstart handler
  setDraggable(bit: boolean): void {
    if (bit) {
      this.draggable = true;
      if (this.detectCollisions && this.useDragHandler) {
        this.useDragHandler.collisionNodes.add(this);
      }
      this.on('mousedown touchstart', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const handler = this.useDragHandler;
        if (!handler) return;

        this.dragDelay = window.setTimeout(() => {
          handler.addListener(this);
          this.cancelClick = true;
          handler.off('catchup');
        }, 350);

        handler.on('catchup', (_evt) => {
          handler.addListener(this);
          this.cancelClick = true;
          handler.off('catchup');
          if (this.dragDelay !== undefined) {
            window.clearTimeout(this.dragDelay);
          }
        });

        handler.dragstart(e);
      });
      this.on('mouseup touchend', (_e) => {
        const handler = this.useDragHandler;
        if (handler) handler.off('catchup');
        if (this.dragDelay !== undefined) {
          window.clearTimeout(this.dragDelay);
        }
      });
    } else {
      if (this.draggable) {
        this.off('mousedown touchstart');
        if (this.useDragHandler) this.useDragHandler.off('catchup');
        this.draggable = false;
        if (this.detectCollisions && this.useDragHandler) {
          this.useDragHandler.collisionNodes.remove(this);
        }
        if (this.clickable) {
          this.setClickable(true);
        }
      }
    }
  }

  setClickable(bit: boolean): void {
    this.cancelClick = true;
    if (bit) {
      this.clickable = true;
      this.on('mousedown touchstart', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.cancelClick = false;
        if (this.cancelClickTimeout !== undefined) {
          window.clearTimeout(this.cancelClickTimeout);
        }
        this.cancelClickTimeout = window.setTimeout(() => {
          this.cancelClick = true;
        }, 1000);
      });
      this.on('mouseup touchend', (e) => {
        if (!this.cancelClick) {
          e.preventDefault();
          e.stopPropagation();
          if (e.shiftKey) {
            this.trigger('vshiftclick');
          } else {
            this.trigger('vclick');
          }
        }
        this.cancelClick = true;
        if (this.useDragHandler) {
          this.useDragHandler.trigger('mouseup');
        }
      });
      this.on('dblclick dbltap', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.trigger('vdblclick');
      });
      this.on('mouseenter', (e) => {
        e.stopPropagation();
        this.trigger('vmouseover');
      });
      this.on('mouseleave', (e) => {
        e.stopPropagation();
        this.trigger('vmouseout');
      });

      // FIXME: DEBUG those Events, remove
      this.on('vclick', (e) => {
        e.stopPropagation();
      });
      this.on('vdblclick', (e) => {
        e.stopPropagation();
      });
    } else {
      if (this.clickable) {
        this.off('mouseup touchend');
        this.off('dblclick dbltap');
        this.off('mouseenter');
        this.off('mouseleave');
        this.clickable = false;
      }
    }
  }
}
