// Render-side `Set` collection — extends the engine-side OrderedSet
// (scripts/game/OrderedSet.ts) with the bulk-action methods the
// renderer's children / decorators / cables collections need
// (`hide` / `show` / `fade` / `draw` / `removeAll`).
// Establishes the scripts/render/ directory and the OrderedSet-share
// pattern.

import { OrderedSet } from '../game/OrderedSet.js';

interface RenderNodeLike {
  hide?(): void;
  show?(): void;
  setOpacity?(opa: number): void;
  draw?(): void;
  remove?(): void;
}

export class RenderSet<T extends RenderNodeLike> extends OrderedSet<T> {
  hide(): void {
    this.each((node) => node.hide?.());
  }

  show(): void {
    this.each((node) => node.show?.());
  }

  fade(opa: number): void {
    this.each((node) => node.setOpacity?.(opa));
  }

  draw(): void {
    this.each((node) => node.draw?.());
  }

  removeAll(): void {
    while (this.set.length > 0) {
      const node = this.set[0];
      if (!node) break;
      this.remove(node);
      node.remove?.();
    }
  }

  /** Empty the set without invoking each item's `remove()`.  Distinct
   *  from `removeAll`. */
  clear(): void {
    this.set.length = 0;
    this.length = 0;
  }
}
