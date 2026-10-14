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
  private _remeasure: ResizeObserver | undefined = undefined;

  static {
    RenderText.prototype.text = '';
    RenderText.prototype.textAlign = 'center';
  }

  constructor(config: TextConfig = {}) {
    // Respect a subclass-supplied jdomelem.  Only fall through to the
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
    // recover on its own.  Remeasure once it is laid out: a
    // ResizeObserver fires when the element leaves display:none, so a
    // hidden view costs nothing per frame.
    const el = this.domelem as HTMLElement;
    if (el.offsetWidth === 0 && t.length > 0 && !this._remeasure) {
      const ro = new ResizeObserver(() => {
        el.style.width = 'auto';
        el.style.height = 'auto';
        if (el.offsetWidth === 0) return;
        ro.disconnect();
        this._remeasure = undefined;
        this.updateText();
        this.draw();
      });
      ro.observe(el);
      this._remeasure = ro;
    }
  }

  override remove(): void {
    // A label removed before it was ever laid out never fires its
    // observer, which would otherwise pin the detached label and node.
    this._remeasure?.disconnect();
    this._remeasure = undefined;
    super.remove();
  }

  updateSize(): void {
    // offsetWidth (the rendered content box) rather than jQuery.width(),
    // which just echoes back a previously-locked CSS width.
    const el = this.domelem as HTMLElement;
    this.width = el.offsetWidth || el.scrollWidth || 200;
  }
}
