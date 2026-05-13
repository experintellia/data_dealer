// Render-side `Text` primitive — a div whose innerHTML is the
// (CRLF-normalised) text content, with measured width fed back to the
// Node bounding box so positioning honours `textAlign`.  Used by FXBling,
// FXBlingQueue, the popup body and several decorator subtypes.
// Pairs with RenderSprite as the two leaf visual primitives every
// remaining Render class either is or extends.

import { crlf2html } from '../dd-helpers.js';
import { type NodeConfig, RenderNode } from './RenderNode.js';
import { getRenderJQuery } from './_jqueryShim.js';

export type TextConfig = NodeConfig & {
  text?: string;
  textAlign?: 'left' | 'center' | 'right';
};

export class RenderText extends RenderNode {
  declare text: string;
  declare textAlign: string;
  private _remeasureScheduled = false;

  static {
    RenderText.prototype.text = '';
    RenderText.prototype.textAlign = 'center';
  }

  constructor(config: TextConfig = {}) {
    // Respect a subclass-supplied jdomelem (e.g. ButtonInline's
    // `<div class='Button'>` wrapper).  Only fall through to the
    // default Text container when no subclass overrode it.
    const jdomelem = config.jdomelem ?? getRenderJQuery('RenderText')("<div class='Text'></div>");
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
    t = crlf2html(t);
    this.text = t;
    this.updateRenderProp();
    this.jdomelem.html(t);
    this.updateSize();
    const w = this.width;
    this.setOffset({
      x: this.textAlign === 'center' ? Math.round(w / 2) : this.textAlign === 'right' ? w : 0,
      y: 0,
    });
    // When inserted under a display:none ancestor (e.g. an inactive
    // Stage), offsetWidth is 0 and the surrounding setSize then locks
    // the inline CSS to width:0px — the centering offset can never
    // recover on its own.  Retry on rAF until the layout fires.
    const el = this.domelem as HTMLElement;
    if (el.offsetWidth === 0 && t.length > 0 && !this._remeasureScheduled) {
      this._remeasureScheduled = true;
      const retry = (): void => {
        if (!this.domelem.isConnected) return;
        el.style.width = 'auto';
        el.style.height = 'auto';
        if (el.offsetWidth === 0) {
          requestAnimationFrame(retry);
          return;
        }
        this._remeasureScheduled = false;
        this.updateText();
        this.draw();
      };
      requestAnimationFrame(retry);
    }
  }

  updateSize(): void {
    // offsetWidth (the rendered content box) rather than jQuery.width(),
    // which just echoes back a previously-locked CSS width.
    const el = this.domelem as HTMLElement;
    this.width = el.offsetWidth || el.scrollWidth || 200;
  }

  /** Note the legacy double-`s` typo: `ssetSize`.  Preserved here
   *  because Render.js's existing call sites — and any external code
   *  exercising the publisher — already use this name. */
  ssetSize(): void {
    this.updateRenderProp();
    this.updateSize();
  }
}
