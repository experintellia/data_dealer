// Render-side FX/animation methods — all the named effects (`FXSimple`,
// `FXBounce`, `FXSpark`, `FXKatsching`, `FXKarmaBling`, `FXLevelUpBling`,
// `FXMissionComplete`, `FXBling`, `FXBlingQueue`, …) that legacy code
// attached to `Node.prototype` inside the Render.js IIFE.
//
// Extracted from scripts/Render.js's IIFE in PR 33 of issue #147.
// Now that `RenderSprite` and `RenderText` are real importable classes
// (PR #217) the FX block no longer depends on the IIFE's closure
// scope, so it can move out wholesale.
//
// Shape:
//   - `applyRenderNodeFX({ Ticker, Tween, Ease })` — called once from
//     Render.js after the IIFE has resolved the CreateJS vendor
//     globals.  Mutates `RenderNode.prototype` so subclass instances
//     (Sprite, Perp, Decorator, Cable, …) pick the methods up through
//     the prototype chain just like the legacy assignment block did.
//   - The FX bodies stay verbatim in spirit — same Tween chains, same
//     callback semantics, same Sprite/Text constructions, same
//     subclass-touch points (`DecoratorAmount`, `gameNode.GameRoot`,
//     `userClickAbsPos`, `renderBlings`, `spinner`).

import { RenderNode } from './RenderNode.js';
import { RenderSprite, type SpriteConfig } from './RenderSprite.js';
import { RenderText, type TextConfig } from './RenderText.js';

// ── CreateJS vendor surface (typed local to this file) ──────────────────────

interface CreateJSTickerLike {
  addListener(target: object): void;
  removeListener(target: object): void;
}

interface TweenChain {
  to(props: Record<string, unknown>, duration?: number, ease?: unknown): TweenChain;
  wait(time: number): TweenChain;
  call(fn: () => void): TweenChain;
}

interface TweenStatic {
  get(target: object, opts?: { override?: boolean; loop?: boolean }): TweenChain;
  hasActiveTweens(target: object): boolean;
}

type EaseFn = (t: number) => number;
interface EaseLike {
  linear: EaseFn;
  easeIn: EaseFn;
  easeOut: EaseFn;
  bounceOut: EaseFn;
  elasticOut: EaseFn;
  backOut: EaseFn;
  backIn: EaseFn;
  [key: string]: EaseFn;
}

export interface RenderNodeFXDeps {
  Ticker: CreateJSTickerLike;
  Tween: TweenStatic;
  Ease: EaseLike;
}

// ── FX method surface — declaration-merged onto RenderNode ──────────────────
//
// `applyRenderNodeFX(deps)` mutates `RenderNode.prototype` so subclass
// instances pick the methods up via the prototype chain.  Module
// augmentation makes those methods visible on `RenderNode` (and its
// subclasses) for any TS caller without extra casts.

interface DecoratorAmountLike {
  hide(): void;
  show(): void;
  setAmount(): void;
}

interface StatusbarLike {
  getTopLeftPosition(): { x: number; y: number };
}

interface FXGameRootLike {
  renderNode: RenderNode & { renderBlings?: Record<string, RenderText> };
  renderStatusbar: StatusbarLike;
}

export interface FXBlingConfig {
  text: string;
  wait?: number;
  dur?: number;
  extendClass?: string;
  x?: number;
  y?: number;
  renderOn?: RenderNode;
}

export interface FXSpinnerConfig {
  text?: string;
  isnew?: boolean;
  duration?: number;
}

export interface FXSparkConfig {
  psid?: string;
  oPos?: { x: number; y: number };
  isnew?: boolean;
}

declare module './RenderNode.js' {
  interface RenderNode {
    // Transient FX state planted on the instance.
    FXAnimation?: TweenChain;
    spinner?: RenderSprite;
    // Subclass fields the FX bodies touch — Decorator family, click
    // handlers, statusbar bling tracking.  Declared optional here so
    // the FX methods type-check against any RenderNode subclass.
    DecoratorAmount?: DecoratorAmountLike;
    userClickAbsPos?: { x: number; y: number };
    renderBlings?: Record<string, RenderText>;
    zoomScale?: number;
    domelem1?: HTMLElement;
    setFrame?(frame: string): void;

    FXSimple(
      config: Record<string, unknown>,
      duration: number,
      easing: string,
      callback?: () => void
    ): TweenChain;
    FXSimpleCue(
      config: Record<string, unknown>,
      duration: number,
      easing?: string,
      callback?: () => void
    ): TweenChain | undefined;
    FXWaitCue(time: number, callback?: () => void): TweenChain | undefined;
    FXStop(): void;
    FXClearCue(): void;
    FXSimpleLoop(
      config: { one: Record<string, unknown>; two: Record<string, unknown> },
      duration: number,
      easing: string,
      callback?: () => void
    ): TweenChain;
    FXBounce(): TweenChain;
    FXSpinner(config?: FXSpinnerConfig, cb?: () => void): void;
    FXSpark(config?: FXSparkConfig, cb?: () => void): void;
    FXWheee(config?: FXSparkConfig & FXSpinnerConfig): void;
    FXWheeeOld(config?: FXSparkConfig & FXSpinnerConfig): void;
    FXMeMeMe(cb?: () => void): void;
    FXNotMeMeMe(cb?: () => void): void;
    FXFeedMe(cb?: () => void): void;
    FXSproing(cb?: () => void): TweenChain;
    FXPuff(cb?: () => void): void;
    FXArise(cb?: () => void): void;
    FXKatsching(cb?: () => void): void;
    FXPulse(cb?: () => void): void;
    FXSnooze(cb?: () => void): void;
    FXSuck(cb?: () => void): void;
    FXCharge(frame?: string, cb?: () => void): void;
    FXKarmaBling(karma_points: number, cb?: () => void): void;
    FXLevelUpBling(xp_level: number, cb?: () => void): void;
    FXMissionComplete(text: string, cb?: () => void): void;
    FXMissionGoalComplete(text: string, cb?: () => void): void;
    FXNoCash(frame?: string, cb?: () => void): void;
    FXNoAP(frame?: string, cb?: () => void): void;
    FXError(frame?: string, cb?: () => void): void;
    FXBlingQueue(config?: FXBlingConfig, cb?: () => void): void;
    FXBling(config: FXBlingConfig, cb?: () => void): void;
    FXElasticTo(pos: { x: number; y: number }, callb?: () => void): TweenChain;
  }
}

// ── helper used by FXSpark / FXWheeeOld ─────────────────────────────────────

interface QueueParentLike {
  domelem1?: HTMLElement;
  domelem: HTMLElement;
}

function computeQueueItemOPos(
  psid: string,
  parentNode: QueueParentLike | undefined,
  oScale: number
): { x: number; y: number } | null {
  // ViewMap/ViewTab.addChild routes children into jdomelem1 (the
  // pan/zoom-transformed container), so we measure against domelem1
  // when present — measuring the outer domelem misses the parent's
  // scroll/zoom translate and the spark starts in the wrong place.
  const item = document.querySelector(
    '.DatabaseQueue .DatabaseQueueItem[data-psid="' + psid + '"]'
  );
  const parentEl = parentNode && (parentNode.domelem1 || parentNode.domelem);
  if (!item || !parentEl) return null;
  const ir = item.getBoundingClientRect();
  const pr = parentEl.getBoundingClientRect();
  const ix = ir.left + ir.width / 2;
  const iy = ir.top + ir.height / 2;
  return {
    x: (ix - pr.left) * oScale,
    y: (iy - pr.top) * oScale,
  };
}

// ── the applier ─────────────────────────────────────────────────────────────

export function applyRenderNodeFX(deps: RenderNodeFXDeps): void {
  const { Ticker, Tween, Ease } = deps;
  const proto = RenderNode.prototype;

  proto.FXSimple = function (
    this: RenderNode,
    config: Record<string, unknown>,
    duration: number,
    easing: string,
    callback?: () => void
  ): TweenChain {
    Ticker.addListener(this);
    this.FXAnimation = Tween.get(this, { override: true })
      .to(config, duration, Ease[easing])
      .call(() => {
        Ticker.removeListener(this);
        if (callback) callback();
      });
    return this.FXAnimation;
  };

  proto.FXSimpleCue = function (
    this: RenderNode,
    config: Record<string, unknown>,
    duration: number,
    easing?: string,
    callback?: () => void
  ): TweenChain | undefined {
    Ticker.addListener(this);
    const ease = easing !== undefined ? Ease[easing] : undefined;
    if (!Tween.hasActiveTweens(this) || !this.FXAnimation) {
      this.FXAnimation = Tween.get(this)
        .to(config, duration, ease)
        .call(() => {
          Ticker.removeListener(this);
          if (callback) callback();
        });
    } else if (Tween.hasActiveTweens(this)) {
      Ticker.addListener(this);
      this.FXAnimation.call(() => {
        Ticker.addListener(this);
      })
        .to(config, duration, ease)
        .call(() => {
          Ticker.removeListener(this);
          if (callback) callback();
        });
    }
    return this.FXAnimation;
  };

  proto.FXWaitCue = function (
    this: RenderNode,
    time: number,
    callback?: () => void
  ): TweenChain | undefined {
    Ticker.addListener(this);
    if (!Tween.hasActiveTweens(this) || !this.FXAnimation) {
      this.FXAnimation = Tween.get(this)
        .wait(time)
        .call(() => {
          Ticker.removeListener(this);
          if (callback) callback();
        });
    } else if (Tween.hasActiveTweens(this)) {
      Ticker.addListener(this);
      this.FXAnimation.call(() => {
        Ticker.addListener(this);
      })
        .wait(time)
        .call(() => {
          Ticker.removeListener(this);
          if (callback) callback();
        });
    }
    return this.FXAnimation;
  };

  proto.FXStop = function (this: RenderNode): void {
    this.FXSimple({}, 0, 'linear');
  };

  proto.FXClearCue = function (this: RenderNode): void {
    delete this.FXAnimation;
  };

  proto.FXSimpleLoop = function (
    this: RenderNode,
    config: { one: Record<string, unknown>; two: Record<string, unknown> },
    duration: number,
    easing: string,
    callback?: () => void
  ): TweenChain {
    Ticker.addListener(this);
    return Tween.get(this, { override: true, loop: true })
      .to(config.one, duration, Ease[easing])
      .to(config.two, duration, Ease[easing])
      .call(() => {
        if (callback) callback();
      });
  };

  proto.FXBounce = function (this: RenderNode): TweenChain {
    Ticker.addListener(this);
    return Tween.get(this, { override: true })
      .to({ scaleX: 1.15, scaleY: 1.15 }, 31, Ease.easeOut)
      .to({ scaleX: 1.1, scaleY: 1.1 }, 31, Ease.easeIn)
      .to({ scaleX: 1, scaleY: 1 }, 200, Ease.bounceOut)
      .call(() => {
        Ticker.removeListener(this);
      });
  };

  proto.FXSpinner = function (this: RenderNode, config?: FXSpinnerConfig, cb?: () => void): void {
    const cfg = config ?? {};
    const text = cfg.text ?? '';
    const duration = (cfg.duration ?? 0) + 400 || 2000;
    if (!this.spinner) {
      this.spinner = new RenderSprite({
        frame: 'normal',
        frameSrc: 'largespinner.png',
        frameMap: {
          normal: { x: 0, y: 0, width: 120, height: 120, pivotx: 60, pivoty: 60 },
        },
        z: -1,
        opacity: 0,
      } as SpriteConfig);
    }
    const spinner = this.spinner;
    Ticker.addListener(this);
    Ticker.addListener(spinner);
    this.DecoratorAmount?.hide();

    spinner.setFrame('normal');
    this.parentNode?.addChild(spinner);
    const nPos = this.getPosition();
    spinner.setPosition(nPos);

    const speed = 1;
    const sps = this.width > 99 ? 1.2 : 1;
    Tween.get(spinner)
      .to({ scaleX: 0.8, scaleY: 0.8, rotate: 125 * speed, opacity: 0 }, 0, Ease.linear)
      .to({ scaleX: sps, scaleY: sps, rotate: 0, opacity: 1 }, 250 * speed, Ease.linear)
      .to({ scaleX: sps, scaleY: sps, rotate: -1000 * speed }, duration * speed, Ease.easeIn)
      .to({ scaleX: 0.8, scaleY: 0.8, rotate: -2000 * speed, opacity: 0 }, 500 * speed, Ease.easeIn)
      .call(() => {
        Ticker.removeListener(this);
        Ticker.removeListener(spinner);
        this.FXBounce();
        this.FXBling({ text, extendClass: 'ProfileBlingSmall' });
        this.DecoratorAmount?.show();
        this.DecoratorAmount?.setAmount();
        spinner.remove();
        delete this.spinner;
        if (cb) cb();
      });
  };

  proto.FXSpark = function (this: RenderNode, config?: FXSparkConfig, cb?: () => void): void {
    const cfg = config ?? {};
    const psid = cfg.psid;
    let oPos = cfg.oPos;
    const isnew = cfg.isnew ?? false;
    const spark = new RenderSprite({
      x: 0,
      y: 0,
      frame: 'normal',
      frameSrc: 'sprite_spark_big.png',
      frameMap: {
        normal: { x: 0, y: 0, width: 36, height: 36, pivotx: 18, pivoty: 18 },
      },
      z: 5000,
      opacity: 1,
    } as SpriteConfig);
    Ticker.addListener(this);
    Ticker.addListener(spark);
    this.DecoratorAmount?.hide();
    spark.setFrame('normal');

    this.parentNode?.addChild(spark);

    const nPos = this.getPosition();
    let oScale = 1;
    if (psid && !oPos) {
      const parent = this.parentNode;
      oScale = 1 / (parent?.zoomScale ?? 1);
      const computed = computeQueueItemOPos(psid, parent as QueueParentLike | undefined, oScale);
      if (computed) oPos = computed;
    }
    if (!oPos) {
      if (cb) cb();
      return;
    }
    const A = nPos.x - oPos.x;
    const O = oPos.y - nPos.y;
    const dir = A > 0 ? 1 : -1;
    const deg = Math.atan(O / Math.abs(A)) * (180 / Math.PI);
    const lenratio = Math.sqrt((oPos.x - nPos.x) ** 2 + (oPos.y - nPos.y) ** 2) / 108;

    spark.setPosition({ x: oPos.x, y: oPos.y });
    spark.rotate = 180 + (90 - deg) * dir;
    spark.scaleX = oScale * 2;
    spark.scaleY = oScale * 2;

    Tween.get(spark)
      .to({ scaleX: oScale * 2, scaleY: oScale * 2 }, 0, Ease.linear)
      .wait(200)
      .to({ scaleX: 0.5, scaleY: lenratio }, 100, Ease.linear)
      .to({ scaleX: 1, x: nPos.x, y: nPos.y, opacity: 1 }, 300, Ease.easeOut)
      .to({ scaleY: 1 }, 100, Ease.linear)
      .call(() => {
        spark.hide();
        if (isnew) this.show();
        this.FXBounce();
        spark.remove();
        if (cb) cb();
      });
  };

  proto.FXWheee = function (this: RenderNode, config?: FXSparkConfig & FXSpinnerConfig): void {
    this.FXSpark(config, () => {
      this.FXSpinner(config);
    });
  };

  proto.FXWheeeOld = function (this: RenderNode, config?: FXSparkConfig & FXSpinnerConfig): void {
    const cfg = config ?? {};
    const text = cfg.text ?? '';
    const psid = cfg.psid;
    let oPos = cfg.oPos;
    const isnew = cfg.isnew ?? false;
    const spinner = new RenderSprite({
      frame: 'normal',
      frameSrc: 'largespinner.png',
      frameMap: {
        normal: { x: 0, y: 0, width: 120, height: 120, pivotx: 60, pivoty: 60 },
      },
      z: -1,
      opacity: 0,
    } as SpriteConfig);
    const spark = new RenderSprite({
      x: 0,
      y: 0,
      frame: 'normal',
      frameSrc: 'sprite_spark_big.png',
      frameMap: {
        normal: { x: 0, y: 0, width: 36, height: 36, pivotx: 18, pivoty: 18 },
      },
      z: 5000,
      opacity: 1,
    } as SpriteConfig);
    Ticker.addListener(this);
    Ticker.addListener(spinner);
    Ticker.addListener(spark);
    this.DecoratorAmount?.hide();
    spinner.setFrame('normal');
    spark.setFrame('normal');

    this.parentNode?.addChild(spark);
    this.parentNode?.addChild(spinner);
    const nPos = this.getPosition();
    let oScale = 1;
    if (psid && !oPos) {
      const parent = this.parentNode;
      oScale = 1 / (parent?.zoomScale ?? 1);
      const computed = computeQueueItemOPos(psid, parent as QueueParentLike | undefined, oScale);
      if (computed) oPos = computed;
    }
    if (!oPos) return;
    spinner.setPosition(nPos);
    const A = nPos.x - oPos.x;
    const O = oPos.y - nPos.y;
    const lenratio = Math.sqrt((oPos.x - nPos.x) ** 2 + (oPos.y - nPos.y) ** 2) / 108;
    const dir = A > 0 ? 1 : -1;
    const deg = Math.atan(O / Math.abs(A)) * (180 / Math.PI);

    spark.setPosition({ x: oPos.x, y: oPos.y });
    spark.rotate = 180 + (90 - deg) * dir;
    spark.scaleX = oScale * 2;
    spark.scaleY = oScale * 2;
    const speed = 1;

    Tween.get(spark)
      .to({ scaleX: oScale * 2, scaleY: oScale * 2 }, 0, Ease.linear)
      .wait(200)
      .to({ scaleX: 0.5, scaleY: lenratio }, 100, Ease.linear)
      .to({ scaleX: 1, x: nPos.x, y: nPos.y, opacity: 1 }, 300, Ease.easeOut)
      .to({ scaleY: 1 }, 100, Ease.linear)
      .call(() => {
        spark.hide();
        if (isnew) this.show();
        this.FXBounce();
      });

    const sps = this.width > 80 ? 1.3 : 1;
    Tween.get(spinner)
      .wait(500)
      .to({ scaleX: 0.8, scaleY: 0.8, rotate: 125 * speed, opacity: 0 }, 0, Ease.linear)
      .to({ scaleX: sps, scaleY: sps, rotate: 0, opacity: 1 }, 250 * speed, Ease.linear)
      .to({ scaleX: sps, scaleY: sps, rotate: -1000 * speed }, 2000 * speed, Ease.easeIn)
      .to({ scaleX: 0.8, scaleY: 0.8, rotate: -2000 * speed, opacity: 0 }, 500 * speed, Ease.easeIn)
      .call(() => {
        Ticker.removeListener(this);
        Ticker.removeListener(spinner);
        this.FXBounce();
        this.FXBling({ text });
        this.DecoratorAmount?.show();
        spinner.remove();
        spark.remove();
      });
  };

  proto.FXMeMeMe = function (this: RenderNode, cb?: () => void): void {
    this.setFrame?.('hover');
    this.FXClearCue();
    this.FXSimpleCue({ scaleX: 1.1, scaleY: 1.1 }, 31, 'easeOut');
    this.FXSimpleCue({ scaleX: 1.07, scaleY: 1.07 }, 31, 'easeOut');
    this.FXSimpleCue({ scaleX: 1, scaleY: 1 }, 200, 'bounceOut', () => {
      if (cb) cb();
    });
  };

  proto.FXNotMeMeMe = function (this: RenderNode, cb?: () => void): void {
    this.setFrame?.('normal');
    if (cb) cb();
  };

  proto.FXFeedMe = function (this: RenderNode): void {
    // '25%':{'transform':'s1.1,1'},
    // '50%':{'transform':'s1,1.1'},
    // '75%':{'transform':'s1.1'},
    // '100%':{'transform':'s1'}
    this.FXSimpleCue({ scaleX: 1.1, sacaleY: 1 }, 37);
    this.FXSimpleCue({ scaleX: 1, scaleY: 1.1 }, 37);
    this.FXSimpleCue({ scaleX: 1.1, scaleY: 1.1 }, 37);
    this.FXSimpleCue({ scaleX: 1, scaleY: 1 }, 37);
  };

  proto.FXSproing = function (this: RenderNode, cb?: () => void): TweenChain {
    Ticker.addListener(this);
    this.setTransform({ scaleX: 0.6, scaleY: 0 });
    this.setOpacity(0);
    return Tween.get(this, { override: true })
      .to({ scaleX: 0.8, scaleY: 1.2, opacity: 0.5 }, 100, Ease.easeOut)
      .to({ scaleX: 1.1, scaleY: 0.8, opacity: 1 }, 100, Ease.easeIn)
      .to({ scaleX: 1, scaleY: 1 }, 500, Ease.elasticOut)
      .call(() => {
        Ticker.removeListener(this);
        if (cb) cb();
      });
  };

  proto.FXPuff = function (this: RenderNode, cb?: () => void): void {
    this.FXSimple({ scaleX: 1.5, scaleY: 1.5, opacity: 0 }, 250, 'easeOut', () => {
      if (cb) cb();
    });
    // make shure it really gets removed (callbacks seem to be unstable)
    window.setTimeout(() => {
      this.remove();
    }, 350);
  };

  proto.FXArise = function (this: RenderNode, cb?: () => void): void {
    const sparkConf: SpriteConfig = {
      x: this.getPosition().x,
      y: this.getPosition().y,
      frame: 'normal',
      frameSrc: 'MainSprites.png',
      frameMap: {
        normal: { x: 679, y: 630, width: 100, height: 100, pivotx: 50, pivoty: 50 },
      },
      z: 10,
      scaleX: 0,
      scaleY: 0,
      opacity: 1,
    } as SpriteConfig;
    const spark = new RenderSprite(sparkConf);
    const spark2 = new RenderSprite(sparkConf);
    Ticker.addListener(spark);
    Ticker.addListener(spark2);

    spark.setFrame('normal');
    spark2.setFrame('normal');
    this.parentNode?.addChild(spark);
    this.parentNode?.addChild(spark2);

    Tween.get(spark)
      .to({ rotate: 90, scaleX: 1, scaleY: 1, opacity: 1 }, 100, Ease.linear)
      .to({ rotate: 200, scaleX: 2.2, scaleY: 2.2, opacity: 1 }, 500, Ease.easeOut)
      .to({ rotate: 300, scaleX: 0, scaleY: 0 }, 500, Ease.easeOut)
      .call(() => {
        spark.remove();
      });
    Tween.get(spark2)
      .to({ rotate: -100, scaleX: 1, scaleY: 1, opacity: 1 }, 100, Ease.linear)
      .to({ rotate: -220, scaleX: 1.8, scaleY: 1.8 }, 500, Ease.easeOut)
      .to({ rotate: -320, scaleX: 0, scaleY: 0 }, 500, Ease.easeOut)
      .call(() => {
        spark2.remove();
      });

    this.scaleX = 0;
    this.scaleY = 0;
    this.opacity = 0;
    this.draw();
    this.show();
    this.FXWaitCue(1000);
    this.FXSimpleCue({ scaleX: 1, scaleY: 1, opacity: 1 }, 350, 'backOut');
    if (cb) {
      window.setTimeout(() => {
        this.opacity = 1;
        cb();
      }, 1200);
    }
  };

  proto.FXKatsching = function (this: RenderNode, cb?: () => void): void {
    // TODO change frame to Cash only and maybe find out absolutepos of cash indicator
    this.setZ(100);
    const sparkConf: SpriteConfig = {
      x: this.getPosition().x - 4,
      y: this.getPosition().y - 40,
      frame: 'normal',
      frameSrc: 'MainSprites.png',
      frameMap: {
        normal: { x: 679, y: 630, width: 100, height: 100, pivotx: 50, pivoty: 50 },
      },
      z: 10,
      scaleX: 0,
      scaleY: 0,
      opacity: 0.5,
    } as SpriteConfig;
    const spark = new RenderSprite(sparkConf);
    const spark2 = new RenderSprite(sparkConf);
    Ticker.addListener(spark);
    Ticker.addListener(spark2);

    spark.setFrame('normal');
    spark2.setFrame('normal');
    this.parentNode?.addChild(spark);
    this.parentNode?.addChild(spark2);

    Tween.get(spark)
      .to({ rotate: 90, scaleX: 1, scaleY: 1, opacity: 0.5 }, 100, Ease.linear)
      .to({ rotate: 200, scaleX: 2.2, scaleY: 2.2, opacity: 0.8 }, 500, Ease.easeOut)
      .to({ rotate: 300, scaleX: 0, scaleY: 0, opacity: 1 }, 200, Ease.easeOut)
      .call(() => {
        spark.remove();
      });
    Tween.get(spark2)
      .to({ rotate: -100, scaleX: 1, scaleY: 1, opacity: 0.5 }, 100, Ease.linear)
      .to({ rotate: -220, scaleX: 1.8, scaleY: 1.8, opacity: 0.6 }, 500, Ease.easeOut)
      .to({ rotate: -320, scaleX: 0, scaleY: 0, opacity: 1 }, 200, Ease.easeOut)
      .call(() => {
        spark2.remove();
      });

    this.FXAnimation = Tween.get(this, { override: true })
      .to({ scaleX: 1, scaleY: 1 }, 100, Ease.linear)
      .wait(500)
      .to({ scaleX: 2, scaleY: 2, opacity: 0 }, 250, Ease.easeOut)
      .call(() => {
        Ticker.removeListener(this);
        if (cb) {
          cb();
          this.remove();
        }
      });
  };

  proto.FXPulse = function (this: RenderNode, cb?: () => void): void {
    this.FXSimpleLoop(
      { one: { scaleX: 0.9, scaleY: 0.9 }, two: { scaleX: 1, scaleY: 1 } },
      350,
      'linear',
      () => {
        if (cb) cb();
      }
    );
  };

  proto.FXSnooze = function (this: RenderNode, cb?: () => void): void {
    this.FXSimpleLoop(
      { one: { scaleX: 0.9, scaleY: 0.9 }, two: { scaleX: 1, scaleY: 1 } },
      250,
      'bounceOut',
      () => {
        if (cb) cb();
      }
    );
  };

  proto.FXSuck = function (this: RenderNode, cb?: () => void): void {
    this.FXSimple({ scaleX: 0.5, scaleY: 0.5, opacity: 0, offsetY: 120 }, 250, 'easeOut', () => {
      if (cb) cb();
      this.remove();
    });
  };

  proto.FXCharge = function (this: RenderNode, frame?: string, cb?: () => void): void {
    const nodePos = this.userClickAbsPos ?? this.getPosition();
    const renderParent: RenderNode | undefined = this.userClickAbsPos ? this : this.parentNode;
    const bling = new RenderSprite({
      x: nodePos.x,
      y: nodePos.y - 400,
      // FIXME: bring some meaning to the z values
      z: 100000,
      hidden: true,
      frame: frame || 'cash',
      frameSrc: 'MainSprites.png',
      frameMap: {
        cash: { x: 145, y: 616, width: 56, height: 43, pivotx: 25, pivoty: 21 },
        AP: { x: 202, y: 616, width: 41, height: 48, pivotx: 20, pivoty: 24 },
      },
    } as SpriteConfig);
    renderParent?.addChild(bling);
    if (frame !== 'AP') {
      bling.FXSimpleCue({ scaleX: 5, scaleY: 5, rotate: -360, opacity: 0 }, 0, 'linear');
    } else {
      bling.FXSimpleCue(
        { y: nodePos.y, scaleX: 1, scaleY: 10, rotate: 10, opacity: 0 },
        0,
        'linear'
      );
    }
    bling.FXWaitCue(200);
    bling.FXSimpleCue({ y: nodePos.y, scaleX: 1, scaleY: 1, rotate: 0, opacity: 1 }, 200, 'linear');
    bling.FXWaitCue(0);
    bling.FXSimpleCue({ scaleX: 0.1, scaleY: 0.1, opacity: 0 }, 500, 'backIn', () => {
      bling.remove();
      if (cb) cb();
    });
  };

  proto.FXKarmaBling = function (this: RenderNode, karma_points: number, cb?: () => void): void {
    const _u = globalThis._;
    const nodePos = this.getCenterPosition();
    nodePos.x += 130;
    nodePos.y = 100;
    const bling = new RenderSprite({
      x: nodePos.x,
      y: nodePos.y,
      z: 10000,
      opacity: 0,
      hidden: true,
      frame: 'karma_up',
      frameSrc: 'MainSprites.png',
      frameMap: {
        karma_up: { x: 428, y: 860, width: 96, height: 96, pivotx: 48, pivoty: 48 },
      },
    } as SpriteConfig);
    this.addChild(bling);
    bling.FXWaitCue(0);
    bling.FXSimpleCue({ scaleX: 0, scaleY: 0, rotate: 720, opacity: 0 }, 0, 'linear', () => {
      bling.FXBling({
        text: '+' + (_u.toKSNum(karma_points) as string),
        wait: 600,
        dur: 1300,
        extendClass: 'KarmaUpBling',
      });
    });
    bling.FXSimpleCue(
      { y: nodePos.y, scaleX: 1.2, scaleY: 1.2, rotate: 0, opacity: 1 },
      500,
      'easeOut'
    );
    bling.FXSimpleCue(
      { y: nodePos.y, scaleX: 1, scaleY: 1, rotate: 0, opacity: 1 },
      250,
      'bounceOut'
    );
    bling.FXWaitCue(800);
    bling.FXSimpleCue(
      { y: nodePos.y - 200, scaleX: 0, scaleY: 4.5, opacity: 0 },
      200,
      'linear',
      () => {
        bling.remove();
        if (cb) cb();
      }
    );
  };

  proto.FXLevelUpBling = function (this: RenderNode, xp_level: number, cb?: () => void): void {
    const nodePos = this.getCenterPosition();
    const bling = new RenderSprite({
      x: nodePos.x,
      y: nodePos.y,
      z: 100000,
      opacity: 0,
      hidden: true,
      frame: 'normal',
      frameSrc: 'MainSprites.png',
      frameMap: {
        normal: { x: 525, y: 842, width: 138, height: 138, pivotx: 69, pivoty: 69 },
      },
    } as SpriteConfig);
    this.addChild(bling);
    bling.FXWaitCue(0);
    bling.FXSimpleCue({ scaleX: 0, scaleY: 0, rotate: 720, opacity: 0 }, 0, 'linear', () => {
      bling.FXBling({
        text: 'Level ' + xp_level,
        wait: 600,
        dur: 1800,
        extendClass: 'LevelUpBlingBig',
      });
    });
    bling.FXSimpleCue(
      { y: nodePos.y, scaleX: 1.2, scaleY: 1.2, rotate: 0, opacity: 1 },
      500,
      'easeOut'
    );
    bling.FXSimpleCue(
      { y: nodePos.y, scaleX: 2, scaleY: 2, rotate: 0, opacity: 1 },
      250,
      'bounceOut'
    );
    bling.FXWaitCue(1000);
    bling.FXSimpleCue(
      { y: nodePos.y - 200, scaleX: 0, scaleY: 4.5, opacity: 0 },
      200,
      'linear',
      () => {
        bling.remove();
        if (cb) cb();
      }
    );
  };

  proto.FXMissionComplete = function (this: RenderNode, _text: string, cb?: () => void): void {
    const nodePos = this.getCenterPosition();
    const bling = new RenderSprite({
      x: nodePos.x,
      y: nodePos.y,
      z: 100000,
      opacity: 0,
      hidden: true,
      frame: 'normal',
      frameSrc: 'MainSprites.png',
      frameMap: {
        normal: { x: 717, y: 764, width: 122, height: 160, pivotx: 55, pivoty: 90 },
      },
    } as SpriteConfig);
    this.addChild(bling);
    bling.FXWaitCue(0);
    bling.FXSimpleCue({ scaleX: 0, scaleY: 0, rotate: 0, opacity: 0 }, 0, 'linear', () => {});
    bling.FXSimpleCue(
      { y: nodePos.y, scaleX: 1.2, scaleY: 1.2, rotate: 0, opacity: 1 },
      250,
      'easeOut'
    );
    bling.FXSimpleCue(
      { y: nodePos.y, scaleX: 1, scaleY: 1, rotate: 0, opacity: 1 },
      250,
      'bounceOut'
    );
    bling.FXWaitCue(1000);
    bling.FXSimpleCue(
      { y: nodePos.y - 200, scaleX: 0, scaleY: 4.5, opacity: 0 },
      200,
      'linear',
      () => {
        bling.remove();
        if (cb) cb();
      }
    );
  };

  proto.FXMissionGoalComplete = function (this: RenderNode, _text: string, cb?: () => void): void {
    const nodePos = this.getTopRightPosition();
    const bling = new RenderSprite({
      x: nodePos.x - 40,
      y: nodePos.y + 50,
      z: 100000,
      opacity: 0,
      hidden: true,
      frame: 'normal',
      frameSrc: 'MainSprites.png',
      frameMap: {
        normal: { x: 717, y: 764, width: 122, height: 160, pivotx: 55, pivoty: 90 },
      },
    } as SpriteConfig);
    this.addChild(bling);
    bling.FXWaitCue(100);
    bling.FXSimpleCue({ scaleX: 0.5, scaleY: 0.5, rotate: 1, opacity: 1 }, 250, 'bounceOut');
    bling.FXWaitCue(1000);
    bling.FXSimpleCue({ scaleX: 0, scaleY: 4.5, opacity: 0 }, 200, 'linear', () => {
      bling.remove();
      if (cb) cb();
    });
  };

  proto.FXNoCash = function (this: RenderNode, frame?: string, cb?: () => void): void {
    const nodePos = this.userClickAbsPos ?? this.getPosition();
    const renderParent: RenderNode | undefined = this.userClickAbsPos ? this : this.parentNode;
    const bling = new RenderSprite({
      x: nodePos.x,
      y: nodePos.y - 400,
      z: 100000,
      opacity: 0,
      hidden: true,
      frame: frame || 'no_cash',
      frameSrc: 'MainSprites.png',
      frameMap: {
        no_cash: { x: 401, y: 737, width: 65, height: 65, pivotx: 32, pivoty: 32 },
        no_AP: { x: 336, y: 737, width: 65, height: 65, pivotx: 32, pivoty: 32 },
      },
    } as SpriteConfig);
    renderParent?.addChild(bling);
    bling.FXSimpleCue({ scaleX: 5, scaleY: 5, rotate: -360, opacity: 0 }, 0, 'linear');
    bling.FXWaitCue(200);
    bling.FXSimpleCue(
      { y: nodePos.y, scaleX: 1, scaleY: 1, rotate: 0, opacity: 1 },
      150,
      'easeOut'
    );
    bling.FXWaitCue(1000);
    bling.FXSimpleCue({ scaleX: 1.5, scaleY: 1.5, opacity: 0, rotate: 360 }, 200, 'linear', () => {
      bling.remove();
      if (cb) cb();
    });
  };

  proto.FXNoAP = function (this: RenderNode, frame?: string, cb?: () => void): void {
    const nodePos = this.userClickAbsPos ?? this.getPosition();
    const renderParent: RenderNode | undefined = this.userClickAbsPos ? this : this.parentNode;
    const bling = new RenderSprite({
      x: nodePos.x,
      y: nodePos.y,
      opacity: 0,
      scaleX: 0,
      scaleY: 0,
      z: 100000,
      hidden: true,
      frame: frame || 'no_AP',
      frameSrc: 'MainSprites.png',
      frameMap: {
        no_AP: { x: 336, y: 737, width: 65, height: 65, pivotx: 32, pivoty: 32 },
        bug: { x: 362, y: 860, width: 65, height: 65, pivotx: 32, pivoty: 32 },
      },
    } as SpriteConfig);
    renderParent?.addChild(bling);
    bling.FXSimpleCue({ scaleX: 0.5, scaleY: 0.5, opacity: 0 }, 100, 'linear');
    bling.FXSimpleCue(
      { y: nodePos.y - 32, scaleX: 1, scaleY: 1, rotate: 0, opacity: 1 },
      200,
      'easeOut'
    );
    bling.FXWaitCue(1000);
    bling.FXSimpleCue(
      { y: nodePos.y - 64, scaleX: 1.5, scaleY: 1.5, opacity: 0 },
      200,
      'linear',
      () => {
        bling.remove();
        if (cb) cb();
      }
    );
  };

  proto.FXError = function (this: RenderNode): void {
    this.FXNoAP('bug');
  };

  proto.FXBlingQueue = function (this: RenderNode, config?: FXBlingConfig, cb?: () => void): void {
    // Topleft Blings for DBQueue
    const _u = globalThis._ as unknown as { keys(o: object): string[]; toKSNum(n: number): string };
    const cfg = config ?? ({ text: '' } as FXBlingConfig);
    const gameNode = this.gameNode as unknown as { GameRoot: FXGameRootLike } | undefined;
    if (!gameNode) return;
    const node = gameNode.GameRoot.renderNode;
    const nodePos = gameNode.GameRoot.renderStatusbar.getTopLeftPosition();
    // Statusbar.css pins the bar to left:0/width:100%, but
    // getTopLeftPosition() still returns stage.width/2 - 360 from the
    // 720 px design — negative on narrower viewports.
    nodePos.x = Math.max(8, nodePos.x);
    cfg.wait = cfg.wait || 0;
    if (!node.renderBlings) {
      node.renderBlings = {};
    }
    const bling = new RenderText({
      x: nodePos.x,
      y: nodePos.y + 40 + (_u.keys(node.renderBlings) as string[]).length * 32,
      z: 1000,
      scaleX: 0,
      scaleY: 0,
      hidden: true,
      text: cfg.text,
      textAlign: 'left',
      extendClass: cfg.extendClass || 'ProfileBling',
    } as TextConfig);
    node.renderBlings[bling.id] = bling;
    node.addChild(bling);
    bling.show();
    bling.FXWaitCue(cfg.wait);
    bling.FXSimpleCue({ scaleX: 1, scaleY: 1 }, 200, 'backOut', () => {});
    bling.FXWaitCue(2000);
    bling.FXSimpleCue({ scaleX: 1.2, scaleY: 1.2, opacity: 0 }, 250, 'easeOut', () => {
      const blings = node.renderBlings;
      if (blings) delete blings[bling.id];
      bling.remove();
      if (cb) cb();
    });
  };

  proto.FXBling = function (this: RenderNode, config: FXBlingConfig, cb?: () => void): void {
    const cfg = config;
    const nodePos = this.getPosition();
    cfg.wait = cfg.wait || 0;
    cfg.dur = cfg.dur || 1000;
    const bling = new RenderText({
      x: cfg.x === undefined ? nodePos.x : cfg.x,
      y: cfg.y === undefined ? nodePos.y - 50 : cfg.y,
      z: 100000,
      hidden: true,
      text: cfg.text,
      extendClass: cfg.extendClass || 'ProfileBling',
    } as TextConfig);
    if (cfg.renderOn) {
      cfg.renderOn.addChild(bling);
    } else {
      this.parentNode?.addChild(bling);
    }
    bling.offsetY = 50;
    bling.FXWaitCue(cfg.wait);
    bling.FXSimpleCue({ scaleX: 0.5, scaleY: 0.5 }, 0, 'linear', () => {
      bling.show();
    });
    bling.FXSimpleCue({ scaleX: 1, scaleY: 1, opacity: 0 }, cfg.dur, 'easeOut', () => {
      bling.remove();
      if (cb) cb();
    });
  };

  proto.FXElasticTo = function (
    this: RenderNode,
    pos: { x: number; y: number },
    callb?: () => void
  ): TweenChain {
    Ticker.addListener(this);
    return Tween.get(this, { override: true })
      .to({ x: pos.x, y: pos.y }, 500, Ease.elasticOut)
      .call(() => {
        if (callb) callb();
        Ticker.removeListener(this);
      });
  };
}
