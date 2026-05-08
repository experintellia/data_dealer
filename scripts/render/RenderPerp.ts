// Render-side `Perp` — interactive Sprite that lives on a ViewMap.
// Owns the per-Perp drag/click event wiring (frame swaps, decorator
// hide/show, cable wobble/straighten on drag), random placement,
// cable connection helpers (`cableTo`, `cableAnimatedTo`,
// `cableAnimatedRemove`, `getCableTo`, `getCablesToOrigin`), and the
// `FXDataIn` / `FXDataOut` data-flow choreography.  Extends
// `RenderSprite` so the frame-map / setFrame / setFrameSrc surface
// is inherited. `cableTo` now constructs `RenderPerpCable` directly
// from scripts/render/RenderCables.ts.

import { type PerpCableConfig, RenderPerpCable } from './RenderCables.js';
import { RenderNode } from './RenderNode.js';
import { type PerpSpriteConfig, RenderPerpSprite } from './RenderPerpSprite.js';
import { RenderSet } from './RenderSet.js';
import { RenderSprite, type SpriteConfig, type SpriteFrameMap } from './RenderSprite.js';
import { getRenderJQuery } from './_jqueryShim.js';

// `RenderPerpCable` is the concrete cable type Perp.cableTo returns.
// Re-exported under the prior `PerpCableLike` name so external
// callers (Game.js still references `cable.perpTo` / `cable.length`
// / `cable.FXDataIn` etc. via this structural surface) keep
// compiling.
export type PerpCableLike = RenderPerpCable;
export type { PerpCableConfig };

interface UnderscoreEachLike {
  each<T>(list: T[] | Record<string, T>, fn: (item: T, key: number | string) => void): void;
}

// ── config shape ────────────────────────────────────────────────────────────

export type PerpConfig = SpriteConfig & {
  cables?: RenderSet<PerpCableLike>;
  perpSprite?: PerpSpriteConfig | RenderPerpSprite;
  draggable?: boolean;
  clickable?: boolean;
  placeRandom?: { x: number; y: number };
  placeParentRadius?: number;
};

// ── the class ───────────────────────────────────────────────────────────────

export class RenderPerp extends RenderSprite {
  declare cables: RenderSet<PerpCableLike>;
  declare perpSprite: RenderPerpSprite | undefined;
  declare placeRandom: { x: number; y: number } | undefined;
  declare placeParentRadius: number | undefined;
  declare sticky: boolean;
  declare dragalong: boolean;

  constructor(config: PerpConfig = {}) {
    const $ = getRenderJQuery('RenderPerp');
    const jdomelem = $("<div class='Perp'></div>");
    const placeRandom =
      config.x === undefined || config.y === undefined ? { x: 1024, y: 800 } : undefined;

    const frameSrc = config.frameSrc ?? 'MainSprites.png';
    const frameMap: SpriteFrameMap = config.frameMap ?? {
      normal: { x: 0, y: 0, width: 80, height: 80, pivotx: 0, pivoty: 0 },
    };
    const frame = config.frame ?? 'normal';
    const cables = config.cables ?? new RenderSet<PerpCableLike>();

    // Pre-upgrade `perpSprite` to a real RenderPerpSprite before
    // calling `super`.  RenderSprite's constructor calls
    // `setFrame()` → `draw()` at the end, and our `draw` override
    // dereferences `this.perpSprite.updatePosition()`, so leaving
    // perpSprite as a plain config object during `super` would
    // crash on `updatePosition is not a function`.
    const perpSpriteInstance =
      config.perpSprite instanceof RenderPerpSprite
        ? config.perpSprite
        : config.perpSprite
          ? new RenderPerpSprite(config.perpSprite as PerpSpriteConfig)
          : undefined;

    super({
      ...config,
      frameSrc,
      frameMap,
      frame,
      // Legacy short-circuit: `clickable: config.clickable || true`
      // collapses to `true` always; preserved verbatim.
      clickable: true,
      detectCollisions: true,
      draggable: config.draggable || true,
      cables: cables as unknown as RenderNode['cables'],
      perpSprite: perpSpriteInstance,
      jdomelem: jdomelem,
    } as SpriteConfig);

    if (placeRandom) {
      this.placeRandom = placeRandom;
    }

    this.initUI();

    if (!config.frameSrc || !config.frameMap) {
      console.log('ERROR: could not render perp ' + (config.id ?? '<no-id>'), config);
    }

    if (perpSpriteInstance) {
      this.addChild(perpSpriteInstance);
    }
  }

  getCableTo(perpTo: RenderPerp): PerpCableLike | undefined {
    let cable: PerpCableLike | undefined;
    this.cables.each((c) => {
      if (c.perpTo === perpTo) {
        cable = c;
      }
    });
    return cable;
  }

  initUI(): void {
    this.on('vclick', (e) => {
      e.stopPropagation();
    });
    this.on('vdblclick', (e) => {
      e.stopPropagation();
    });

    this.on('dragstart', (e) => {
      e.stopPropagation();
      this.setFrame('drag');
      this.setZ(100);
      if (this.perpSprite) {
        this.perpSprite.offsetX += 2;
        this.perpSprite.offsetY += 5;
        this.perpSprite.draw();
      }
      this.decorators.hide();
      if (!this.sticky && !this.dragalong) {
        this.cables.each((cable) => {
          if (cable.noWobble) {
            cable.FXToggleConnect(0);
          } else {
            cable.FXWobbleTension(0.5);
          }
        });
      } else if (!this.sticky && this.dragalong) {
        this.cables.each((cable) => {
          cable.FXStraighten(0);
        });
      } else if (this.sticky) {
        this.cables.each((cable) => {
          const othernode = (cable.perpFrom === this ? cable.perpTo : cable.perpFrom) as RenderPerp;
          if (othernode.sticky) {
            if (cable.noWobble) {
              cable.FXToggleConnect(0);
            } else {
              cable.FXWobbleTension(0.5);
            }
          } else {
            othernode.dragalong = true;
            othernode.useDragHandler?.addListener(othernode);
          }
        });
      }
    });

    this.on('dragend', (e) => {
      e.stopPropagation();

      this.setZ(0);
      this.setFrame('normal');
      this.draw();
      if (this.perpSprite) {
        this.perpSprite.offsetX -= 2;
        this.perpSprite.offsetY -= 5;
        this.perpSprite.draw();
      }
      this.decorators.show();
      this.decorators.draw();
      this.cables.each((cable) => {
        if (this.dragalong) {
          cable.FXStraighten(1);
        } else {
          if (cable.noWobble) {
            cable.FXToggleConnect(1);
          } else {
            cable.FXWobbleTension(1);
          }
        }
      });
      this.dragalong = false;
    });
    this.on('mousedown touchstart', (e) => {
      e.stopPropagation();
    });
    this.on('vmouseover', (e) => {
      e.stopPropagation();
      // FIXME: Write own Event Wrapper for hover events
      const target = (e as unknown as { target?: unknown }).target;
      if (target !== this.domelem) {
        return;
      }
      if (!this.dragging) {
        this.setFrame('hover');
        this.FXBounce();
      } else {
        this.setFrame('drag');
      }
    });
    this.on('vmouseout', (_e) => {
      if (this.dragging) {
        this.setFrame('drag');
      } else {
        this.setFrame('normal');
      }
    });
  }

  // RenderNode declares `dragBound` as an optional property
  // (`((pos) => void) | undefined`), so we override with a property
  // initializer rather than a method to satisfy the TS class-shape
  // check.  The arrow keeps `this` bound to the Perp instance.
  override dragBound: (pos: { x: number; y: number }) => void = (pos) => {
    if (!this.parentNode) {
      return;
    }
    if (pos.x < 35) {
      pos.x = 35;
    } else if (pos.x > this.parentNode.width - 35) {
      pos.x = this.parentNode.width - 35;
    }
    if (pos.y < 100) {
      pos.y = 100;
    } else if (pos.y > this.parentNode.height - 100) {
      pos.y = this.parentNode.height - 100;
    }
  };

  override moveTo(pos: { x: number; y: number }): void {
    // Used during animations, to also draw and render other Nodes affected by movement.
    this.setPosition(pos);
    this.cables.draw();
    this.decorators.draw();
  }

  // FIXME random placement, remove
  setRandomPosition(originPos?: { x: number; y: number }): void {
    let tries = 0;
    const start = originPos ?? { x: 1024, y: 800 };
    const randomPos = (pos: { x: number; y: number }): { x: number; y: number } => ({
      x: pos.x + 60 * (Math.random() < 0.5 ? 1 : -1),
      y: pos.y + 40 * (Math.random() < 0.5 ? 1 : -1),
    });
    if (!this.useDragHandler) return;
    let testPos = this.useDragHandler.getCollisionPos(this, start);
    while (tries < 500 && testPos.coll === true) {
      testPos = { ...testPos, ...randomPos(testPos) };
      if (this.placeParentRadius) {
        testPos = { ...testPos, ...this.testParentRadius(testPos, this.placeParentRadius) };
      }
      testPos.coll = this.useDragHandler.testCollisions(this, testPos);
      tries += 1;
    }
    this.setPosition(testPos);
  }

  override onAddInit(): void {
    if (this.draggable) {
      this.setDraggable(true);
    }
    if (this.clickable) {
      this.setClickable(true);
    }
    if (this.placeRandom) {
      this.setRandomPosition(this.placeRandom);
    }
    this.updateRenderProp();
    this.draw();
  }

  cableTo(otherperp: RenderPerp, config?: PerpCableConfig): PerpCableLike | string {
    // Connect this Perp to another one, Perps need to live on the same Node, usually a ViewMap.
    if (!this.parentNode || !otherperp.parentNode || this.parentNode !== otherperp.parentNode) {
      return 'Could not connect';
    }
    const cfg = config ?? {};
    const perpcable = new RenderPerpCable(cfg, this, otherperp);
    this.parentNode.addChild(perpcable);
    return perpcable;
  }

  cableAnimatedTo(
    otherperp: RenderPerp,
    config?: PerpCableConfig,
    cb?: () => void
  ): PerpCableLike | string {
    const cfg = { ...(config ?? {}), hidden: true };
    const cable = this.cableTo(otherperp, cfg);
    if (typeof cable === 'string') return cable;
    cable.FXConnect(cb);
    return cable;
  }

  cableAnimatedRemove(otherperp: RenderPerp): void {
    const cable = this.getCableTo(otherperp);
    if (!cable) {
      return;
    }
    cable.FXDisconnect(() => {
      cable.remove();
    });
  }

  override draw(): void {
    if (this.dragging) {
      this.moveTo(this.getPosition());
    } else {
      this.setPosition(this.getPosition());
    }
    this.setTransform(this.getTransform());
    this.setSize(this.getSize());
    this.setOpacity(this.opacity);
    if (this.perpSprite) {
      this.perpSprite.updatePosition();
    }
  }

  getCablesToOrigin(): PerpCableLike[] {
    // Doesn't work on a graph, obviously
    const cables: PerpCableLike[] = [];
    if (!this.cables.set.length) {
      return cables;
    }
    this.cables.each((cable) => {
      if (cable.perpTo === this) {
        const parentPerp = cable.perpFrom;
        cables.push(cable);
        for (const pcable of parentPerp.getCablesToOrigin()) {
          cables.push(pcable);
        }
      }
    });
    return cables;
  }

  FXDataOut(cb?: () => void): number {
    const _u = globalThis._ as unknown as UnderscoreEachLike;
    const cables = this.getCablesToOrigin();
    let duration = 500;
    let delay = 0;
    _u.each(cables, (cable, k) => {
      duration = cable.length * 2;
      if ((k as number) === cables.length - 1) {
        const endPerp = cable.perpFrom;
        window.setTimeout(() => {
          cable.FXDataIn(() => {
            endPerp.FXFeedMe();
            if (cb) cb();
          });
        }, delay);
      } else {
        window.setTimeout(() => {
          cable.FXDataIn(() => {
            if (cb) cb();
          });
        }, delay);
      }
      delay = delay + duration;
    });
    return delay;
  }

  // TODO: Make Loop with FX Start/Stop options
  FXDataIn(cb?: () => void): number {
    const _u = globalThis._ as unknown as UnderscoreEachLike;
    const cables = this.getCablesToOrigin().reverse();
    let duration = 500;
    let delay = 0;
    _u.each(cables, (cable, k) => {
      duration = cable.length * 2;
      if ((k as number) === cables.length - 1) {
        window.setTimeout(() => {
          cable.FXDataOut(cb);
        }, delay);
      } else {
        window.setTimeout(() => {
          cable.FXDataOut();
        }, delay);
      }
      delay = delay + duration;
    });
    return delay;
  }
}
