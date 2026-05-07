// Render-side `Text` primitive — a div whose innerHTML is the
// (CRLF-normalised) text content, with measured width fed back to the
// Node bounding box so positioning honours `textAlign`.  Used by FXBling,
// FXBlingQueue, the popup body and several decorator subtypes.
//
// Extracted from scripts/Render.js's IIFE in PR 32 of issue #147.
// Pairs with RenderSprite as the two leaf visual primitives every
// remaining Render class either is or extends.

import { type JQueryNodeElem, type NodeConfig, RenderNode } from './RenderNode.js';

interface JQueryTextElem {
  0: HTMLElement;
  attr(name: string, value: string): unknown;
  html(content: string): unknown;
  width(): number | undefined;
}

interface UnderscoreCrlf {
  crlf2html(text: string): string;
}

function getJQuery(): (selector: string) => JQueryTextElem {
  const jq = (globalThis.jQuery ?? globalThis.$) as
    | ((selector: string) => JQueryTextElem)
    | undefined;
  if (!jq) {
    throw new Error('RenderText requires the jQuery global to be loaded.');
  }
  return jq;
}

export type TextConfig = NodeConfig & {
  text?: string;
  textAlign?: 'left' | 'center' | 'right';
};

export class RenderText extends RenderNode {
  declare text: string;
  declare textAlign: string;

  static {
    RenderText.prototype.text = '';
    RenderText.prototype.textAlign = 'center';
  }

  constructor(config: TextConfig = {}) {
    // Respect a subclass-supplied jdomelem (e.g. ButtonInline's
    // `<div class='Button'>` wrapper).  Only fall through to the
    // default Text container when no subclass overrode it.
    const jdomelem =
      config.jdomelem ?? (getJQuery()("<div class='Text'></div>") as unknown as JQueryNodeElem);
    super({ ...config, jdomelem });
  }

  override updateRenderProp(): void {
    this.css({
      top: 0,
      left: 0,
      'text-align': this.textAlign,
      'z-index': this.z,
      position: this.position,
    });
  }

  override draw(): void {
    this.setTransform(this.getTransform());
    this.setPosition(this.getPosition());
    this.setOpacity(this.opacity);
  }

  override onAddInit(): void {
    this.updateText(this.text);
    this.draw();
  }

  updateText(text?: string): void {
    let t = text;
    if (!t) {
      t = this.text;
    }
    const _ = globalThis._ as unknown as UnderscoreCrlf;
    t = _.crlf2html(t);
    this.text = t;
    this.updateRenderProp();
    (this.jdomelem as unknown as JQueryTextElem).html(t);
    this.updateSize();
    const newOffset = { x: 0, y: 0 };
    const width = (this.jdomelem as unknown as JQueryTextElem).width() ?? 200;
    if (this.textAlign === 'center') {
      newOffset.x = Math.round(width / 2);
    } else if (this.textAlign === 'right') {
      newOffset.x = width;
    }
    this.setOffset(newOffset);
  }

  updateSize(): void {
    this.width = (this.jdomelem as unknown as JQueryTextElem).width() ?? 200;
  }

  /** Note the legacy double-`s` typo: `ssetSize`.  Preserved here
   *  because Render.js's existing call sites — and any external code
   *  exercising the publisher — already use this name. */
  ssetSize(): void {
    this.updateRenderProp();
    this.updateSize();
  }
}
