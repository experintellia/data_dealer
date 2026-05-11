// Render-side `Sprite` primitive — a div with a CSS background-image
// from a sprite-sheet, indexed by named frames.  Foundation for Perp,
// PerpSprite, the FX bling animations, and several decorator types.
// Pairs with RenderText as the two leaf visual primitives the rest
// of the Render wave depends on.

import setup from '../setup.js';
import { type NodeConfig, RenderNode } from './RenderNode.js';
import { getRenderJQuery } from './_jqueryShim.js';

export interface SpriteFrame {
  x: number;
  y: number;
  width: number;
  height: number;
  pivotx: number;
  pivoty: number;
}

export type SpriteFrameMap = Record<string, SpriteFrame>;

export type SpriteConfig = NodeConfig & {
  frame?: string;
  frameSrc?: string;
  frameMap?: SpriteFrameMap;
};

export class RenderSprite extends RenderNode {
  declare frameSrc: string;
  declare frameMap: SpriteFrameMap;
  frame: string;
  spriteSrc: string | undefined = undefined;

  static {
    RenderSprite.prototype.frameSrc = '';
    RenderSprite.prototype.frameMap = {
      normal: { x: 0, y: 0, width: 0, height: 0, pivotx: 0, pivoty: 0 },
    };
  }

  constructor(config: SpriteConfig = {}) {
    // Respect a subclass-supplied jdomelem (e.g. DecoratorTimer's
    // custom `<div class='DecoratorTimer'>` wrapper that already
    // holds the canvas + text children).  Only fall through to the
    // default Sprite container when no subclass overrode it.
    const jdomelem =
      config.jdomelem ?? getRenderJQuery('RenderSprite')("<div class='Sprite'></div>");
    super({ ...config, jdomelem });
    // super → RenderNode.init → setAttrs(config) has already assigned
    // frameSrc / frameMap / frame from `config` (when present).  Apply
    // the legacy `frame || 'normal'` fallback explicitly.
    // Ensure frameMap falls back to the prototype default if not set.
    console.log('[RenderSprite] constructor:', {
      frameMap: this.frameMap,
      frameMapType: typeof this.frameMap,
      normal: this.frameMap?.normal,
      frame: config.frame ?? 'normal',
    });
    if (!this.frameMap || typeof this.frameMap !== 'object' || !this.frameMap.normal) {
      console.log('[RenderSprite] frameMap invalid, using prototype default');
      this.frameMap = RenderSprite.prototype.frameMap;
    }
    this.frame = config.frame ?? 'normal';
    this.setFrameSrc(this.frameSrc);
    console.log('[RenderSprite] calling setFrame with frame:', this.frame);
    this.setFrame(this.frame);
    console.log('[RenderSprite] setFrame done, calling draw');
    this.draw();
    console.log('[RenderSprite] draw done');
  }

  setFrameSrc(src: string | undefined): void {
    if (!this.frameSrc) {
      return;
    }
    this.spriteSrc = src;
    this.css({
      'background-image': 'url(' + setup.imagePathPrefix + this.frameSrc + ')',
    });
  }

  setFrame(frame: string): void {
    console.log('[setFrame] frame:', frame, 'frameMap:', this.frameMap);
    if (!this.frameMap || typeof this.frameMap !== 'object') {
      console.log('[setFrame] frameMap invalid, returning');
      return;
    }
    if (!Object.prototype.hasOwnProperty.call(this.frameMap, frame)) {
      console.log('[setFrame] frame not in frameMap, returning');
      return;
    }
    const map = this.frameMap[frame];
    console.log('[setFrame] map:', map);
    if (!map || typeof map !== 'object') {
      console.log('[setFrame] map invalid, returning');
      return;
    }
    if (
      typeof map.x !== 'number' ||
      typeof map.y !== 'number' ||
      typeof map.width !== 'number' ||
      typeof map.height !== 'number'
    ) {
      console.log('[setFrame] map properties invalid:', {
        'map.x': map.x,
        'typeof map.x': typeof map.x,
        'map.y': map.y,
        'map.width': map.width,
        'map.height': map.height,
      });
      return;
    }
    this.frame = frame;
    this.width = map.width;
    this.height = map.height;
    if (map.pivotx && map.pivoty) {
      this.setOffset({ x: map.pivotx, y: map.pivoty });
    }
    console.log('[setFrame] setting backgroundPosition: -' + map.x + 'px -' + map.y + 'px');
    this.domelem.style.backgroundPosition = -map.x + 'px ' + -map.y + 'px';
    console.log('[setFrame] calling draw');
    this.draw();
    console.log('[setFrame] done');
  }
}
