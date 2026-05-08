// Render-side `PerpSprite` — an inner-sprite child layered onto a
// Perp's domelem.  Reads its frame-map pivots from the parent Perp
// when its own entries omit `pivotx`/`pivoty`, then snaps to the
// parent's offset.  Used by Perp subclasses that need a secondary
// foreground sprite (e.g. ContactPerp's expression layer).
// Perp's ctor wires `new RenderPerpSprite()` when `config.perpSprite`
// is set.

import { RenderNode } from './RenderNode.js';
import { RenderSprite, type SpriteConfig, type SpriteFrame } from './RenderSprite.js';
import { getRenderJQuery } from './_jqueryShim.js';

export type PerpSpriteConfig = SpriteConfig;

export class RenderPerpSprite extends RenderSprite {
  constructor(config: PerpSpriteConfig = {}) {
    const $ = getRenderJQuery('RenderPerpSprite');
    const jdomelem = $("<div class='PerpSprite'></div>");
    super({
      ...config,
      frame: config.frame ?? 'normal',
      jdomelem: jdomelem,
    } as SpriteConfig);
  }

  override onAddInit(): void {
    const parent = this.parentNode as
      | (RenderNode & {
          perpSprite?: RenderPerpSprite;
          frameMap: { normal: SpriteFrame };
          offsetX: number;
          offsetY: number;
        })
      | undefined;
    if (parent) {
      parent.perpSprite = this;
      // Set position to parent pivot — fill in any missing
      // pivotx/pivoty entries from the parent's `normal` frame.
      for (const frame of Object.values(this.frameMap)) {
        if (!frame.pivotx) {
          frame.pivotx = parent.frameMap.normal.pivotx;
        }
        if (!Object.prototype.hasOwnProperty.call(frame, 'pivoty')) {
          frame.pivoty = parent.frameMap.normal.pivoty;
        }
      }
    }

    this.setFrameSrc(this.frameSrc);
    this.setFrame(this.frame);
    if (parent) {
      this.setPosition({ x: parent.offsetX, y: parent.offsetY });
    }

    this.draw();
    this.updateRenderProp();
  }

  updatePosition(): void {
    const parent = this.parentNode;
    if (!parent) return;
    this.setPosition({ x: parent.offsetX, y: parent.offsetY });
  }
}
