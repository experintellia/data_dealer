// Render-side `DragHandler` — manages window-level drag state for
// the renderer's draggable nodes (perps + popup).  Reads pointer / touch
// events off `$(window)` and dispatches `dragstart` / `dragmove` /
// `dragend` to listening nodes. Self-contained: depends only on the
// jQuery `$` global and the previously-extracted RenderSet.

import { OrderedSet } from '../game/OrderedSet.js';

// Module-load DOM-availability probes; both values are fixed for the
// lifetime of this realm.
const HAS_WINDOW = typeof window !== 'undefined';
const HAS_DOC = typeof document !== 'undefined';

interface PointerLike {
  pageX: number;
  pageY: number;
}

interface DragEventLike {
  pageX?: number;
  pageY?: number;
  shiftKey?: boolean;
  originalEvent?: {
    touches?: ArrayLike<PointerLike>;
    changedTouches?: ArrayLike<PointerLike>;
  };
  preventDefault(): void;
  stopPropagation(): void;
}

interface JQueryEventTarget {
  on(event: string, handler: (e: DragEventLike) => void): unknown;
  off(event: string): unknown;
  trigger(event: string, params?: unknown[]): unknown;
}

/**
 * Minimal contract a node must satisfy to be tracked by RenderDragHandler.
 * Render's `Node` / `Perp` classes provide all of these; the interface lets
 * us type the handler without depending on those (still-untyped) classes.
 */
export interface DraggableNode {
  offsetX: number;
  offsetY: number;
  // `T | undefined` (not optional `T?`) so the declared RenderNode
  // shape (which uses the `T | undefined` form for
  // `exactOptionalPropertyTypes` reasons) lines up.  Legacy nodes
  // lazy-allocate this on first `addListener` call.
  dragStartPos: { x: number; y: number } | undefined;
  dragging: boolean;
  getPosition(): { x: number; y: number };
  getSize(): { width: number; height: number };
  trigger(event: string): void;
  moveTo(pos: { x: number; y: number }): void;
  clipCablePos(pos: { x: number; y: number }): { x: number; y: number };
}

interface CollisionPos {
  x: number;
  y: number;
  coll: boolean;
}

export class RenderDragHandler {
  jdomelem: JQueryEventTarget;
  domelem: Window;
  scale: number;
  listeners: DraggableNode[];
  state: 'stopped' | 'started' | 'moved';
  dragging: boolean;
  dragVector: { x: number; y: number };
  dragStartPos: { x: number; y: number };
  dragMovePos: { x: number; y: number };
  collisionNodes: OrderedSet<DraggableNode>;
  // Stored so `dispose()` can detach the recovery listeners init() attaches.
  private _recoveryHandlers: Array<{ target: EventTarget; type: string; listener: EventListener }> =
    [];

  constructor() {
    const $ = globalThis.jQuery ?? globalThis.$;
    if (!$) {
      throw new Error('RenderDragHandler requires the jQuery global to be loaded.');
    }
    this.jdomelem = $(window) as unknown as JQueryEventTarget;
    this.domelem = window;
    this.scale = 1;
    this.listeners = [];
    this.state = 'stopped';
    this.dragging = false;
    this.dragVector = { x: 0, y: 0 };
    this.dragStartPos = { x: 0, y: 0 };
    this.dragMovePos = { x: 0, y: 0 };
    this.collisionNodes = new OrderedSet<DraggableNode>();
    this.init();
  }

  addListener(node: DraggableNode): void {
    node.dragStartPos = {
      x: node.getPosition().x,
      y: node.getPosition().y,
    };
    node.dragging = true;
    node.trigger('dragstart');
    this.listeners.push(node);
  }

  removeListener(node: DraggableNode): void {
    const index = this.listeners.indexOf(node);
    if (index !== -1) {
      const listener = this.listeners[index];
      if (listener) listener.trigger('dragend');
      this.listeners.splice(index, 1);
    }
  }

  dragstart(e: DragEventLike): void {
    this.state = 'started';
    // FIXME: trigger touchhandling broken?!
    const touch = RenderDragHandler._touchFrom(e);
    const userPos =
      touch !== undefined
        ? { x: touch.pageX, y: touch.pageY }
        : { x: e.pageX ?? 0, y: e.pageY ?? 0 };
    this.dragStartPos = userPos;
    this.dragMovePos = userPos;
    this.dragging = true;
    this.dragVector.x = (this.dragMovePos.x - this.dragStartPos.x) * this.scale;
    this.dragVector.y = (this.dragMovePos.y - this.dragStartPos.y) * this.scale;
  }

  // Idempotent — recovery handlers in init() may call this for the same
  // gesture as the regular mouseup/touchend path; the empty-listeners
  // loop and flag flip are safe to repeat.
  dragend(_e?: DragEventLike): void {
    this.state = 'stopped';
    for (const node of this.listeners) {
      node.dragging = false;
      node.trigger('dragend');
    }
    this.listeners.length = 0;
    this.dragging = false;
  }

  on(event: string, func: (e: DragEventLike) => void): void {
    this.jdomelem.on(event, func);
  }

  off(event: string): void {
    this.jdomelem.off(event);
  }

  trigger(event: string, params?: unknown[]): void {
    this.jdomelem.trigger(event, params);
  }

  getCollisionPos(node: DraggableNode, newPos: { x: number; y: number }): CollisionPos {
    const result: CollisionPos = {
      x: newPos.x,
      y: newPos.y,
      coll: false,
    };
    const posX = newPos.x - node.offsetX;
    const posY = newPos.y - node.offsetY;
    const width = node.getSize().width;
    const height = node.getSize().height;
    const rect1 = {
      tl: { x: posX, y: posY },
      tr: { x: posX + width, y: posY },
      bl: { x: posX, y: posY + height },
      br: { x: posX + width, y: posY + height },
    };

    this.collisionNodes.each((other) => {
      if (other === node) return;
      const posX2 = other.getPosition().x - other.offsetX;
      const posY2 = other.getPosition().y - other.offsetY;
      const width2 = other.getSize().width;
      const height2 = other.getSize().height;
      const rect2 = {
        tl: { x: posX2, y: posY2 },
        tr: { x: posX2 + width2, y: posY2 },
        bl: { x: posX2, y: posY2 + height2 },
        br: { x: posX2 + width2, y: posY2 + height2 },
      };
      if (
        rect1.br.x < rect2.bl.x ||
        rect1.bl.x > rect2.br.x ||
        rect1.bl.y < rect2.tl.y ||
        rect1.tl.y > rect2.bl.y
      ) {
        return;
      }
      result.coll = true;
      const width12 = width / 2 + width2 / 2;
      const height12 = height / 2 + height2 / 2;
      const overlapX = rect1.tr.x - rect2.tl.x - width12;
      const overlapY = rect1.bl.y - rect2.tl.y - height12;
      if (Math.abs(overlapY) > Math.abs(overlapX)) {
        if (overlapY > 0) {
          result.y = newPos.y + (height12 - overlapY);
        } else {
          result.y = newPos.y - (height12 + overlapY);
        }
      } else {
        if (overlapX > 0) {
          result.x = newPos.x + (width12 - overlapX);
        } else {
          result.x = newPos.x - (width12 + overlapX);
        }
      }
    });
    return result;
  }

  testCollisions(node: DraggableNode, newPos: { x: number; y: number }): boolean {
    let coll = false;
    const posX = newPos.x - node.offsetX;
    const posY = newPos.y - node.offsetY;
    const width = node.getSize().width;
    const height = node.getSize().height;
    const rect1 = {
      tl: { x: posX, y: posY },
      tr: { x: posX + width, y: posY },
      bl: { x: posX, y: posY + height },
      br: { x: posX + width, y: posY + height },
    };

    this.collisionNodes.each((other) => {
      if (other === node) return;
      const posX2 = other.getPosition().x - other.offsetX;
      const posY2 = other.getPosition().y - other.offsetY;
      const width2 = other.getSize().width;
      const height2 = other.getSize().height;
      const rect2 = {
        tl: { x: posX2, y: posY2 },
        tr: { x: posX2 + width2, y: posY2 },
        bl: { x: posX2, y: posY2 + height2 },
        br: { x: posX2 + width2, y: posY2 + height2 },
      };
      if (
        !(
          rect1.br.x < rect2.bl.x ||
          rect1.bl.x > rect2.br.x ||
          rect1.bl.y < rect2.tl.y ||
          rect1.tl.y > rect2.bl.y
        )
      ) {
        coll = true;
      }
    });
    return coll;
  }

  getCollisions(_node?: DraggableNode): boolean {
    if (this.collisionNodes.set.length === 0) {
      return false;
    }
    // TODO: Calculate or store Bounding-Box on Perp generation for performance reasons
    //       and to get better visual collisions (e.g. store in framemaps...)
    const data: Array<{
      tl: { x: number; y: number };
      tr: { x: number; y: number };
      bl: { x: number; y: number };
      br: { x: number; y: number };
    }> = [];
    this.collisionNodes.each((other) => {
      const posX = other.getPosition().x - other.offsetX;
      const posY = other.getPosition().y - other.offsetY;
      const width = other.getSize().width;
      const height = other.getSize().height;
      data.push({
        tl: { x: posX, y: posY },
        tr: { x: posX + width, y: posY },
        bl: { x: posX, y: posY + height },
        br: { x: posX + width, y: posY + height },
      });
    });

    let i = data.length;
    while (i--) {
      let l = data.length;
      while (l-- && l !== i) {
        const a = data[i];
        const b = data[l];
        if (!a || !b) continue;
        if (!(b.br.x < a.bl.x || b.bl.x > a.br.x || b.bl.y < a.tl.y || b.tl.y > a.bl.y)) {
          return true;
        }
      }
    }
    return false;
  }

  init(): void {
    // Guard against accidental re-init (constructor is the only current
    // caller, but the recovery listeners would double up otherwise).
    if (this._recoveryHandlers.length > 0) return;
    this.on('mouseup touchend', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.dragend(e);
    });
    // Releasing the pointer outside the canvas, an OS gesture cancellation,
    // alt-tabbing, or tab-hide all skip `mouseup`/`touchend` — funnel them
    // through the same dragend path so the drag can't get stuck.
    const recover = (): void => {
      if (this.dragging) this.dragend();
    };
    const addRecovery = (target: EventTarget, type: string, listener: EventListener): void => {
      target.addEventListener(type, listener);
      this._recoveryHandlers.push({ target, type, listener });
    };
    if (HAS_WINDOW) {
      addRecovery(window, 'pointercancel', recover);
      addRecovery(window, 'blur', recover);
    }
    if (HAS_DOC) {
      addRecovery(document, 'visibilitychange', () => {
        if (document.hidden) recover();
      });
    }
    this.on('mousemove touchmove', (e) => {
      if (!this.dragging) {
        return;
      }
      this.state = 'moved';
      // FIXME: touchhandling broken?!
      const touch = RenderDragHandler._touchFrom(e);
      const userPos =
        touch !== undefined
          ? { x: touch.pageX, y: touch.pageY }
          : { x: e.pageX ?? 0, y: e.pageY ?? 0 };
      this.dragMovePos = userPos;
      this.dragVector.x = (this.dragMovePos.x - this.dragStartPos.x) * this.scale;
      this.dragVector.y = (this.dragMovePos.y - this.dragStartPos.y) * this.scale;
      // Drag pixel threshold
      if (Math.abs(this.dragVector.x) > 16 || Math.abs(this.dragVector.y) > 16) {
        this.trigger('catchup');
      }
      for (const node of this.listeners) {
        node.trigger('dragmove');
        // Node's `addListener` has just set this; if a caller
        // mutated it to undefined out from under us, fall back to
        // the current position.
        const start = node.dragStartPos ?? { x: 0, y: 0 };
        const newPos = {
          x: start.x + this.dragVector.x,
          y: start.y + this.dragVector.y,
        };
        if (e.shiftKey) {
          newPos.x = Math.round(newPos.x / 20) * 20;
          newPos.y = Math.round(newPos.y / 20) * 20;
        }
        // Start: Perp related special draghandling
        const clipped = node.clipCablePos(newPos);
        // Delete line below to turn on collisions
        node.moveTo(clipped);
      }
    });
  }

  dispose(): void {
    for (const h of this._recoveryHandlers) {
      h.target.removeEventListener(h.type, h.listener);
    }
    this._recoveryHandlers.length = 0;
  }

  private static _touchFrom(e: DragEventLike): PointerLike | undefined {
    const orig = e.originalEvent;
    if (!orig) return undefined;
    const touches = orig.touches;
    if (touches !== undefined) {
      return touches[0] ?? orig.changedTouches?.[0];
    }
    return undefined;
  }
}
