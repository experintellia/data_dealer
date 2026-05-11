// Render-side `Cable` + `PerpCable` primitives — canvas-rendered
// connection lines between two endpoints.  `Cable` is the simple
// point-to-point form; `PerpCable` extends it to track two `RenderPerp`
// endpoints, register itself with their `cables` sets, and refresh
// its endpoints from each perp's live position on every draw.
// Retires the `setPerpCableCtor()` seam — RenderPerp can now
// `import { RenderPerpCable }` directly, since the type circularity
// (RenderPerpCable's `perpFrom`/`perpTo` reference RenderPerp;
// RenderPerp.cableTo constructs RenderPerpCable) is broken at the
// runtime level by `import type` for the perp reference inside
// this file.
//
// The shared sprite tile images (`SparkImg`, `PlugImg`, `KrapsImg`,
// `GulpImg`) used by the cable draw routine moved here too; they
// were IIFE-locals in Render.js with no external readers.

import { type NodeConfig, RenderNode } from './RenderNode.js';
// Type-only import breaks the runtime cycle with RenderPerp.
import type { RenderPerp } from './RenderPerp.js';
import { RenderSet } from './RenderSet.js';
import { getRenderJQuery } from './_jqueryShim.js';

// ── shared sprite tiles for the cable draw routine ──────────────────────────
//
// Lazy-initialised so the module load doesn't depend on
// `globalThis.Image` being available at parse time.

interface CableSprites {
  SparkImg: HTMLImageElement;
  SparkImg0: HTMLImageElement;
  PlugImg: HTMLImageElement;
  KrapsImg: HTMLImageElement;
  KrapsImg0: HTMLImageElement;
  GulpImg: HTMLImageElement;
}

let _sprites: CableSprites | undefined;

function getSprites(): CableSprites {
  if (!_sprites) {
    const make = (src: string): HTMLImageElement => {
      const img = new Image();
      img.src = src;
      return img;
    };
    _sprites = {
      SparkImg: make('img/sprite_spark.png'),
      SparkImg0: make('img/sprite_spark_small.png'),
      PlugImg: make('img/sprite_plug.png'),
      KrapsImg: make('img/sprite_kraps.png'),
      KrapsImg0: make('img/sprite_kraps_small.png'),
      GulpImg: make('img/sprite_gulp.png'),
    };
  }
  return _sprites;
}

// ── cable resolution ─────────────────────────────────────────────────────────
//
// Static value 2 — controls the path step-size in the draw routine.

const _cableResolution = 2;

// ── Cable (base) ────────────────────────────────────────────────────────────

export type CableConfig = NodeConfig & {
  tension?: number;
  cableMaxLength?: number;
  offsetX?: number;
  offsetY?: number;
  pointFrom?: { x: number; y: number };
  pointTo?: { x: number; y: number };
  hidden?: boolean;
  mode?: 'in' | 'out' | 'inout';
};

export class RenderCable extends RenderNode {
  declare domelem: HTMLCanvasElement;
  tension: number;
  cableMaxLength: number;
  pointFrom: { x: number; y: number };
  pointTo: { x: number; y: number };
  length = 0;
  noWobble?: boolean;

  declare straightness: number;
  declare progress: number;
  declare dataposIn: number;
  declare dataposOut: number;
  declare mode: 'in' | 'out' | 'inout';
  declare colorIn: string;
  declare colorOut: string;

  static {
    const p = RenderCable.prototype;
    p.straightness = 1;
    p.progress = 1;
    p.dataposIn = 0;
    p.dataposOut = 0;
    p.mode = 'in';
    p.colorIn = '#16A3D7';
    p.colorOut = '#E85E2B';
  }

  constructor(config: CableConfig = {}) {
    const jdomelem =
      config.jdomelem ?? getRenderJQuery('RenderCables')("<canvas class='Cable'></canvas>");
    super({
      ...config,
      z: config.z ?? -1,
      jdomelem,
    });
    this.tension = config.tension ?? 1;
    this.cableMaxLength = config.cableMaxLength ?? 400;
    this.offsetX = config.offsetX ?? 16;
    this.offsetY = config.offsetY ?? 16;
    this.pointFrom = config.pointFrom ?? { x: 350, y: 50 };
    this.pointTo = config.pointTo ?? { x: 550, y: 250 };
  }

  getPoints(): { p1: { x: number; y: number }; p5: { x: number; y: number } } {
    return {
      p1: this.pointFrom,
      p5: this.pointTo,
    };
  }

  getLength(): number {
    // This is the old Bezier fallback, not in use currently
    const p = this.getPoints();
    const cx = p.p1.x < p.p5.x ? p.p1.x : p.p5.x;
    const cy = p.p1.y < p.p5.y ? p.p1.y : p.p5.y;
    const x = p.p1.x - cx + this.offsetX;
    const y = p.p1.y - cy + this.offsetY;
    const x2 = p.p5.x - cx + this.offsetX;
    const y2 = p.p5.y - cy + this.offsetY;
    const dx = x2 - x;
    const dy = y2 - y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  override draw(): void {
    if (this.hidden || this.progress <= 0) {
      this.css({ display: 'none' });
      return;
    }
    this.css({ display: 'block' });

    let offset = 0;
    if (this.mode === 'inout') {
      offset = 4;
    }
    const p = this.getPoints();
    const domelem = this.domelem;
    if (domelem instanceof HTMLCanvasElement) {
      const width = Math.abs(p.p1.x - p.p5.x) + this.offsetX * 2;
      const height = Math.abs(p.p1.y - p.p5.y) + this.offsetY * 2;
      domelem.width = width;
      domelem.height = height;
      this.width = width;
      this.height = height;
    }
    const cx = p.p1.x < p.p5.x ? p.p1.x : p.p5.x;
    const cy = p.p1.y < p.p5.y ? p.p1.y : p.p5.y;

    this.setTransform(this.getTransform());
    this.setPosition({ x: cx, y: cy });
    const tension = this.tension;
    const cableMaxLength = this.cableMaxLength;
    let x = p.p1.x - cx + this.offsetX;
    const y = p.p1.y - cy + this.offsetY;
    const x2 = p.p5.x - cx + this.offsetX;
    const y2 = p.p5.y - cy + this.offsetY;

    const dx = x2 - x;
    const dy = y2 - y;
    const len = Math.sqrt(dx * dx + dy * dy);
    this.length = len;

    const sinefreq = 360;
    const dxa = Math.abs(dx);
    const dya = Math.abs(dy);
    const slope = dx * dy > 0 ? -1 : 1;
    const radalpha = dxa < dya ? Math.asin(dx / len) : Math.asin(dy / len);
    const radbeta = Math.PI / 2 - Math.abs(radalpha);
    const sineamp = (len / 4 / Math.tan(radbeta)) * slope;

    // Resolution of path:
    const seqs = _cableResolution;
    // Dash Array
    const da: [number, number] = [seqs, 0];

    const ctx = this.domelem.getContext('2d');
    if (!ctx) return;
    const rot = Math.atan2(dy, dx);
    ctx.lineWidth = 6;

    ctx.translate(x, y);
    ctx.rotate(rot);

    let dc = da.length;
    let di = 0;
    let draw = true;
    let vari = 0;
    let snu = 0;
    let stretch = cableMaxLength - len;
    let flatness = stretch < 0 ? 0 : (stretch / cableMaxLength) * this.straightness;
    let progress = len * this.progress;

    const sprites = getSprites();

    // Orange Cable (Data out of DB)
    if (this.mode === 'out' || this.mode === 'inout') {
      ctx.beginPath();
      ctx.moveTo(len - offset, offset);
      x = 0;
      snu = sinefreq / len;
      while (x < progress) {
        const step = da[di++ % dc];
        if (step === undefined) break;
        x += step;
        if (x > len) {
          x = len;
        }
        vari = Math.sin((x * snu * Math.PI) / 180) * sineamp * flatness;
        vari = vari + Math.sin((x * snu * ((1 - tension) * 15) * Math.PI) / 180) * 15 * flatness;
        if (draw) {
          ctx.lineTo(len - x, -vari + offset);
        } else {
          ctx.moveTo(len - x, -vari + offset);
        }
        draw = !draw;
      }

      ctx.lineCap = 'butt';
      ctx.strokeStyle = this.colorOut;
      ctx.stroke();

      if (this.progress > 0 && this.progress < 1) {
        progress = len * this.progress;
        x = len - progress - 16;
        vari = Math.sin((x * snu * Math.PI) / 180) * sineamp * flatness;
        vari = vari + Math.sin((x * snu * ((1 - tension) * 18) * Math.PI) / 180) * 15 * flatness;
        ctx.drawImage(sprites.GulpImg, x, vari - 8 + offset);
      }
    }

    // Blue Cable (Data into DB)
    if (this.mode === 'in' || this.mode === 'inout') {
      ctx.beginPath();
      ctx.moveTo(0 - offset, 0 - offset);
      dc = da.length;
      di = 0;
      draw = true;
      x = 0;
      vari = 0;
      snu = sinefreq / len;
      stretch = cableMaxLength - len;
      flatness = stretch < 0 ? 0 : (stretch / cableMaxLength) * this.straightness;
      progress = len * this.progress;
      while (x < progress) {
        const step = da[di++ % dc];
        if (step === undefined) break;
        x += step;
        if (x > len) {
          x = len;
        }
        vari = Math.sin((x * snu * Math.PI) / 180) * sineamp * flatness;
        vari = vari + Math.sin((x * snu * ((1 - tension) * 15) * Math.PI) / 180) * 15 * flatness;
        if (draw) {
          ctx.lineTo(x, vari - offset);
        } else {
          ctx.moveTo(x, vari - offset);
        }
        draw = !draw;
      }

      ctx.lineCap = 'butt';
      ctx.strokeStyle = this.colorIn;
      ctx.stroke();
      if (this.progress > 0 && this.progress < 1) {
        progress = len * this.progress;
        x = progress + 8;
        vari = Math.sin((x * snu * Math.PI) / 180) * sineamp * flatness;
        vari = vari + Math.sin((x * snu * ((1 - tension) * 18) * Math.PI) / 180) * 15 * flatness;
        ctx.drawImage(sprites.PlugImg, x - 8, vari - 8 - offset);
      }
    }

    // Data Sprites

    if (this.dataposIn > 0 && this.dataposIn < 1) {
      const datapos = len * this.dataposIn;
      x = datapos - 10;
      vari = Math.sin((x * snu * Math.PI) / 180) * sineamp * flatness;
      vari = vari + Math.sin((x * snu * ((1 - tension) * 18) * Math.PI) / 180) * 15 * flatness;
      ctx.drawImage(sprites.SparkImg0, x - 12, vari - 12 - offset);
      x = x + 10;
      vari = Math.sin((x * snu * Math.PI) / 180) * sineamp * flatness;
      vari = vari + Math.sin((x * snu * ((1 - tension) * 18) * Math.PI) / 180) * 15 * flatness;
      ctx.drawImage(sprites.SparkImg, x - 16, vari - 16 - offset);
      x = x + 10;
      vari = Math.sin((x * snu * Math.PI) / 180) * sineamp * flatness;
      vari = vari + Math.sin((x * snu * ((1 - tension) * 15) * Math.PI) / 180) * 15 * flatness;
      ctx.drawImage(sprites.SparkImg0, x - 12, vari - 12 - offset);
      void datapos;
    }
    if (this.dataposOut > 0 && this.dataposOut < 1) {
      const datapos = len * this.dataposOut;
      x = datapos - 10;
      vari = Math.sin((x * snu * Math.PI) / 180) * sineamp * flatness;
      vari = vari + Math.sin((x * snu * ((1 - tension) * 18) * Math.PI) / 180) * 15 * flatness;
      ctx.drawImage(sprites.KrapsImg0, x - 12, vari - 12 + offset);
      x = x + 10;
      vari = Math.sin((x * snu * Math.PI) / 180) * sineamp * flatness;
      vari = vari + Math.sin((x * snu * ((1 - tension) * 18) * Math.PI) / 180) * 15 * flatness;
      ctx.drawImage(sprites.KrapsImg, x - 16, vari - 16 + offset);
      x = x + 10;
      vari = Math.sin((x * snu * Math.PI) / 180) * sineamp * flatness;
      vari = vari + Math.sin((x * snu * ((1 - tension) * 15) * Math.PI) / 180) * 15 * flatness;
      ctx.drawImage(sprites.KrapsImg0, x - 12, vari - 12 + offset);
      void datapos;
    }
  }

  FXWobbleTension(tension: number): unknown {
    const duration = tension < 1 ? 300 : 500;
    return this.FXSimpleCue({ tension }, duration, 'easeOut');
  }

  FXToggleConnect(progress: number): unknown {
    const duration = progress < 1 ? 200 : 800;
    return this.FXSimpleCue({ progress }, duration, 'sineInOut');
  }

  FXStraighten(straightness: number): unknown {
    const easing = straightness === 1 ? 'easeOut' : 'linear';
    const duration = straightness === 1 ? 200 : 100;
    return this.FXSimpleCue({ straightness }, duration, easing);
  }

  FXConnect(cb?: () => void): unknown {
    this.progress = 0;
    this.show();
    return this.FXSimpleCue({ progress: 1 }, 1000, 'sineInOut', cb);
  }

  FXDisconnect(cb?: () => void): unknown {
    this.progress = 1;
    return this.FXSimpleCue({ progress: 0 }, 500, 'sineInOut', cb);
  }

  FXDataIn(cb?: () => void): unknown {
    const duration = this.length * 2;
    this.FXSimpleCue({ dataposIn: 1 }, 0);
    return this.FXSimpleCue({ dataposIn: 0 }, duration, 'linear', cb);
  }

  FXDataOut(cb?: () => void): unknown {
    const duration = this.length * 2;
    this.FXSimpleCue({ dataposOut: 0 }, 0);
    return this.FXSimpleCue({ dataposOut: 1 }, duration, 'linear', cb);
  }
}

// ── PerpCable ───────────────────────────────────────────────────────────────

export type PerpCableConfig = CableConfig;

export class RenderPerpCable extends RenderCable {
  perpFrom: RenderPerp;
  perpTo: RenderPerp;

  constructor(config: PerpCableConfig, perpFrom: RenderPerp, perpTo: RenderPerp) {
    const $ = getRenderJQuery('RenderCables');
    const jdomelem = $("<canvas class='Cable'></canvas>");
    // Clip to 480px, so Cables usually are never longer than 512 (texture size)
    super({
      ...config,
      tension: config.tension ?? 1,
      cableMaxLength: config.cableMaxLength ?? 480,
      offsetX: config.offsetX ?? 16,
      offsetY: config.offsetY ?? 16,
      jdomelem: jdomelem,
      pointFrom: perpFrom.getPosition(),
      pointTo: perpTo.getPosition(),
    });
    this.perpFrom = perpFrom;
    this.perpTo = perpTo;
    (perpFrom.cables as RenderSet<RenderPerpCable>).add(this);
    (perpTo.cables as RenderSet<RenderPerpCable>).add(this);
  }

  override getPoints(): { p1: { x: number; y: number }; p5: { x: number; y: number } } {
    return {
      p1: this.perpFrom.getPosition(),
      p5: this.perpTo.getPosition(),
    };
  }
}
