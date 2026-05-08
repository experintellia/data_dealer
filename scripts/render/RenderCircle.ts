// Render-side `Circle` primitive — a `<canvas>`-backed circle with
// configurable radius / fill / stroke.  Used today only for a
// commented-out cursor experiment in ViewMap, and exported via the
// publisher for any external tooling.
//
// Extracted from scripts/Render.js's IIFE in PR 34 of issue #147.

import { type NodeConfig, RenderNode } from './RenderNode.js';
import { getRenderJQuery } from './_jqueryShim.js';

export type CircleConfig = NodeConfig & {
  radius?: number;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
};

export class RenderCircle extends RenderNode {
  declare domelem: HTMLCanvasElement;
  radius: number;
  fill: string;
  stroke: string;
  strokeWidth: number;

  constructor(config: CircleConfig = {}) {
    const $ = getRenderJQuery('RenderCircle');
    const jdomelem = $("<canvas class='Circle'></canvas>");
    super({ ...config, jdomelem: jdomelem });
    this.radius = config.radius ?? 32;
    this.fill = config.fill ?? '#C00';
    this.stroke = config.stroke ?? '#F00';
    this.strokeWidth = config.strokeWidth ?? 0;
  }

  override draw(): void {
    this.setSize({
      width: this.radius * 2 + this.strokeWidth * 2,
      height: this.radius * 2 + this.strokeWidth * 2,
    });
    this.setOffset({
      x: this.width / 2,
      y: this.height / 2,
    });
    this.setTransform(this.getTransform());
    this.setOpacity(this.opacity);

    const canvas = this.domelem;
    canvas.width = this.width;
    canvas.height = this.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.beginPath();
    ctx.lineWidth = this.strokeWidth;
    ctx.arc(this.offsetX, this.offsetY, this.radius, 0, 2 * Math.PI, false);
    ctx.strokeStyle = this.stroke;
    ctx.fillStyle = this.fill;
    if (this.strokeWidth) {
      ctx.stroke();
    }
    ctx.fill();
  }
}
