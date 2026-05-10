// Render-side `RenderSprite` helper — a small utility (NOT the
// `RenderSprite` class!) that takes a frame-map config and returns
// an HTML string suitable for templates' `<%= … %>` interpolation.
// Lives in its own module so MainMenu (in RenderViews.ts) and Popup
// (still inline in Render.js) can both import it without duplicating
// the body.

import setup from '../setup.js';
import { getRenderJQuery } from './_jqueryShim.js';

interface SpriteFrame {
  x: number;
  y: number;
  width: number;
  height: number;
  pivotx: number;
  pivoty: number;
}

type SpriteFrameMap = Record<string, SpriteFrame>;

export interface SpriteHelperConfig {
  frameSrc?: string;
  frameMap?: SpriteFrameMap;
  frame?: string;
  className?: string;
  dataButtonId?: string;
}

/** Builds a `<div class='RenderSprite'>` HTML string for the given
 *  frame-map config, with the background-image / background-position /
 *  width / height / pivot-offset CSS pre-baked.  Returns an empty
 *  string if `config` is missing required fields (preserves legacy
 *  Render.js behaviour). */
export function renderSpriteHtml(config: SpriteHelperConfig | undefined, frame?: string): string {
  if (!config || !config.frameSrc || !config.frameMap) {
    return '';
  }
  const $ = getRenderJQuery('renderSpriteHtml');
  const frameSrc = config.frameSrc;
  const frameMap = config.frameMap;
  if (!frameSrc || !frameMap) return '';
  const activeFrame = frame || config.frame || 'normal';

  const jdomelem = $("<div class='RenderSprite'></div>");
  if (config.className) {
    jdomelem.addClass(config.className);
  }
  if (config.dataButtonId) {
    jdomelem.attr('data-button-id', config.dataButtonId);
  }
  const domelem = jdomelem[0];
  jdomelem.css({
    'background-image': 'url(' + setup.imagePathPrefix + frameSrc + ')',
  });
  const map = frameMap[activeFrame];
  if (!map || typeof map.x !== 'number' || typeof map.y !== 'number') {
    return '';
  }
  jdomelem.width(map.width);
  jdomelem.height(map.height);
  if (map.pivotx && map.pivoty) {
    jdomelem.css({
      left: -map.pivotx,
      top: -map.pivoty,
    });
  }
  domelem.style.backgroundPosition = -map.x + 'px ' + -map.y + 'px';
  return domelem.outerHTML;
}
