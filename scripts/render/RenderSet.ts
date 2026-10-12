// Render-side `Set` collection — extends the engine-side OrderedSet
// (scripts/game/OrderedSet.ts) with the bulk-action methods the
// renderer's children / decorators / cables collections need
// (`hide` / `show` / `draw` / `removeAll`).
// Establishes the scripts/render/ directory and the OrderedSet-share
// pattern.

import { OrderedSet } from '../game/OrderedSet.js';

interface RenderNodeLike {
  hide?(): void;
  show?(): void;
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
}
