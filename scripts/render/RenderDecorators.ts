// Render-side `Decorator` family — the seven small overlay classes
// that bolt onto a parent render node and render alongside it
// (`Decorator` base, `DecoratorReady`, `DecoratorLabel`,
// `DecoratorNew`, `DecoratorGear`, `DecoratorTimer`,
// `DecoratorAmount`).  Each tracks an `offsetToParent`, hides /
// shows / draws relative to its `decoratedNode`, and most reuse the
// shared `decoratorDraw` placement logic (DecoratorTimer overrides
// with its own canvas-arc countdown render).
// DecoratorTimer imports `SlowTicker` directly from
// scripts/render/RenderSlowTicker.ts.

import { toKSNum, toTime } from '../dd-helpers.js';
import i18n from '../i18n.js';
import { type DecoType, type NodeConfig, RenderNode } from './RenderNode.js';
import { RenderSlowTicker } from './RenderSlowTicker.js';
import { RenderSprite, type SpriteConfig, type SpriteFrameMap } from './RenderSprite.js';
import { RenderText, type TextConfig } from './RenderText.js';
import { type JQueryRenderElem, getRenderJQuery } from './_jqueryShim.js';

// Local alias kept for the internal `getReadyText` template-cache
// type; functionally equivalent to JQueryRenderElem.
type JQueryDecoratorElem = JQueryRenderElem;

// ── shared draw helper (reused by every decorator except Timer) ─────────────

function decoratorDraw(node: RenderNode & DecoratorBase): void {
  if (node.hidden) return;
  if (!node.decoratedNode) return;
  const decorPos = node.decoratedNode.getPosition();
  const offsetToParent = node.offsetToParent;
  // Guard against undefined position or offset values
  if (!decorPos || decorPos.x === undefined || decorPos.y === undefined) return;
  if (!offsetToParent || offsetToParent.x === undefined || offsetToParent.y === undefined) return;
  node.setSize(node.getSize());
  node.setTransform(node.getTransform());
  node.setPosition({
    x: decorPos.x + offsetToParent.x,
    y: decorPos.y + offsetToParent.y,
  });
  node.setOpacity(node.opacity);
}

// Common shape every decorator instance has — the parent-relative
// offset is always present (either supplied via config or defaulted
// per-class).
interface DecoratorBase {
  offsetToParent: { x: number; y: number };
}

// ── Decorator (base) ────────────────────────────────────────────────────────
//
// A Decorator is bound to its decorated parent Node by the draw
// function but lives on the same container.

export type DecoratorConfig = NodeConfig & {
  offsetToParent?: { x: number; y: number };
};

export class RenderDecorator extends RenderNode implements DecoratorBase {
  offsetToParent: { x: number; y: number };

  constructor(config: DecoratorConfig = {}) {
    const $ = getRenderJQuery('RenderDecorators');
    const jdomelem = $("<div class='Decorator'></div>");
    super({ ...config, jdomelem: jdomelem });
    this.offsetToParent = config.offsetToParent ?? { x: 0, y: 0 };
  }

  override remove(): void {
    if (this.decoratedNode) {
      this.decoratedNode.decorators.remove(this);
    }
    super.remove();
  }

  override draw(): void {
    decoratorDraw(this);
  }
}

// ── DecoratorReady ──────────────────────────────────────────────────────────

export type DecoratorReadyConfig = SpriteConfig & {
  offsetToParent?: { x: number; y: number };
  mode?: 'profile' | 'money' | 'gear';
};

const FRAME_PROFILE: SpriteFrameMap = {
  normal: { x: 50, y: 668, width: 46, height: 58, pivotx: 25, pivoty: 56 },
  hover: { x: 96, y: 664, width: 48, height: 62, pivotx: 27, pivoty: 60 },
  active: { x: 420, y: 660, width: 57, height: 70, pivotx: 31, pivoty: 64 },
};
const FRAME_MONEY: SpriteFrameMap = {
  normal: { x: 203, y: 668, width: 52, height: 59, pivotx: 29, pivoty: 57 },
  hover: { x: 145, y: 663, width: 58, height: 64, pivotx: 33, pivoty: 62 },
  active: { x: 144, y: 616, width: 58, height: 44, pivotx: 33, pivoty: 63 },
};
const FRAME_GEAR_READY: SpriteFrameMap = {
  normal: { x: 779, y: 668, width: 46, height: 58, pivotx: 25, pivoty: 56 },
  hover: { x: 825, y: 664, width: 48, height: 62, pivotx: 27, pivoty: 60 },
  active: { x: 873, y: 678, width: 57, height: 70, pivotx: 28, pivoty: 64 },
};

// Lazy-built jQuery templates — legacy stored these on
// `Decorator.prototype.textCollect` etc. at IIFE-body time.  Holding
// them as cached module-scoped templates lets us preserve the
// `textCollect.clone()` pattern without forcing module load to wait
// for jQuery to be present.
let _textCollect: JQueryDecoratorElem | undefined;
let _textCollectGear: JQueryDecoratorElem | undefined;
let _textCollectCash: JQueryDecoratorElem | undefined;

function getReadyText(mode: 'profile' | 'money' | 'gear'): JQueryDecoratorElem {
  const $ = getRenderJQuery('RenderDecorators');
  if (mode === 'money') {
    if (!_textCollectCash) {
      _textCollectCash = $(
        '<div class="DecoratorReadyText Cash">' + i18n.gettext('Cash up!') + '</div>'
      );
    }
    return _textCollectCash;
  }
  if (mode === 'gear') {
    if (!_textCollectGear) {
      _textCollectGear = $('<div class="DecoratorReadyText">' + i18n.gettext('Update!') + '</div>');
    }
    return _textCollectGear;
  }
  if (!_textCollect) {
    _textCollect = $('<div class="DecoratorReadyText">' + i18n.gettext('Collect!') + '</div>');
  }
  return _textCollect;
}

export class RenderDecoratorReady extends RenderSprite implements DecoratorBase {
  declare decoType: DecoType;
  offsetToParent: { x: number; y: number };

  constructor(config: DecoratorReadyConfig = {}) {
    const $ = getRenderJQuery('RenderDecorators');
    const jdomelem = $("<div class='DecoratorReady'></div>");
    jdomelem.attr('data-testid', 'dd-collect-ready');

    const mode: 'profile' | 'money' | 'gear' = config.mode ?? 'profile';
    const frameMap =
      mode === 'money' ? FRAME_MONEY : mode === 'gear' ? FRAME_GEAR_READY : FRAME_PROFILE;
    const textCollect = getReadyText(mode);
    jdomelem.append(textCollect.clone());

    super({
      ...config,
      frameSrc: config.frameSrc ?? 'MainSprites.png',
      frameMap,
      frame: config.frame ?? 'normal',
      clickable: true,
      jdomelem: jdomelem,
    } as SpriteConfig);

    this.offsetToParent = config.offsetToParent ?? { x: 0, y: -30 };
  }

  override onAddInit(): void {
    if (this.clickable) {
      this.setClickable(true);
    }
    if (this.decoratedNode) {
      this.offsetToParent = { x: 0, y: -this.decoratedNode.height / 2 + 15 };
    }
    this.initUI();
    this.updateRenderProp();
    this.draw();
  }

  initUI(): void {
    this.on('vclick', (e) => {
      e.stopPropagation();
      this.jdomelem.find('.DecoratorReadyText').remove();
    });
    this.on('vdblclick', (e) => {
      e.stopPropagation();
    });
    this.on('vmouseover', (e) => {
      e.stopPropagation();
      this.FXMeMeMe();
    });
    this.on('vmouseout', (e) => {
      e.stopPropagation();
      this.FXNotMeMeMe();
    });
  }

  override draw(): void {
    decoratorDraw(this);
  }
}

RenderDecoratorReady.prototype.decoType = 'DecoratorReady';

// ── DecoratorLabel ──────────────────────────────────────────────────────────

export type DecoratorLabelConfig = TextConfig & {
  offsetToParent?: { x: number; y: number };
  textFontSize?: string;
};

export class RenderDecoratorLabel extends RenderText implements DecoratorBase {
  declare decoType: DecoType;
  offsetToParent: { x: number; y: number };
  textFontSize: string;

  constructor(config: DecoratorLabelConfig = {}) {
    const $ = getRenderJQuery('RenderDecorators');
    const jdomelem = $("<div class='DecoratorLabel'></div>");
    super({
      ...config,
      text: config.text ?? 'Label',
      clickable: false,
      jdomelem: jdomelem,
    } as TextConfig);
    this.offsetToParent = config.offsetToParent ?? { x: 0, y: 0 };
    this.textFontSize = '13px';
  }

  override onAddInit(): void {
    if (this.decoratedNode) {
      this.offsetToParent = {
        x: 0 + this.offsetToParent.x,
        y: this.decoratedNode.height - this.decoratedNode.offsetY - 1 + this.offsetToParent.y,
      };
    }
    this.updateText();
    this.draw();
  }

  override draw(): void {
    decoratorDraw(this);
  }
}

RenderDecoratorLabel.prototype.decoType = 'DecoratorLabel';

// ── DecoratorNew ────────────────────────────────────────────────────────────

export type DecoratorNewConfig = TextConfig & {
  offsetToParent?: { x: number; y: number };
  textFontSize?: string;
  arrow?: boolean;
  extendClass?: string;
};

export class RenderDecoratorNew extends RenderText implements DecoratorBase {
  declare decoType: DecoType;
  offsetToParent: { x: number; y: number };
  textFontSize: string;
  declare arrow: boolean | undefined;

  constructor(config: DecoratorNewConfig = {}) {
    const $ = getRenderJQuery('RenderDecorators');
    const jdomelem = $("<div class='DecoratorNew'></div>");
    if (config.extendClass) {
      jdomelem.addClass(config.extendClass);
    }
    super({
      ...config,
      text: config.text ?? 'New!',
      clickable: true,
      jdomelem: jdomelem,
    } as TextConfig);
    this.offsetToParent = config.offsetToParent ?? { x: 0, y: 0 };
    this.textFontSize = '13px';
  }

  override onAddInit(): void {
    if (this.decoratedNode) {
      if (this.arrow) {
        this.offsetToParent = { x: 0, y: -this.decoratedNode.height / 2 - 32 };
      } else {
        this.offsetToParent = { x: 0, y: -this.decoratedNode.height / 2 - 8 };
      }
    }
    if (this.clickable) {
      this.setClickable(true);
    }
    this.initUI();
    this.updateText();
    if (this.arrow) {
      this.jdomelem.append('<br /><div class="DecoratorNewArrow"></div>');
    }
    this.draw();
  }

  initUI(): void {
    this.on('vclick', (e) => {
      e.stopPropagation();
      if (this.decoratedNode) {
        this.decoratedNode.trigger('vclick');
      }
    });
  }

  override draw(): void {
    decoratorDraw(this);
  }
}

RenderDecoratorNew.prototype.decoType = 'DecoratorNew';

// ── DecoratorGear ───────────────────────────────────────────────────────────

const FRAME_GEAR_DEFAULT: SpriteFrameMap = {
  normal: { x: 347, y: 582, width: 28, height: 28, pivotx: 14, pivoty: 14 },
  inactive: { x: 375, y: 582, width: 28, height: 28, pivotx: 14, pivoty: 14 },
};

export type DecoratorGearConfig = SpriteConfig & {
  offsetToParent?: { x: number; y: number };
};

export class RenderDecoratorGear extends RenderSprite implements DecoratorBase {
  declare decoType: DecoType;
  offsetToParent: { x: number; y: number };

  constructor(config: DecoratorGearConfig = {}) {
    const $ = getRenderJQuery('RenderDecorators');
    const jdomelem = $("<div class='DecoratorGear'></div>");
    const frameMap = config.frameMap ?? FRAME_GEAR_DEFAULT;
    super({
      ...config,
      frameSrc: config.frameSrc ?? 'MainSprites.png',
      frameMap,
      frame: config.frame ?? 'normal',
      clickable: true,
      width: frameMap.normal?.width,
      height: frameMap.normal?.height,
      jdomelem: jdomelem,
    } as SpriteConfig);
    this.offsetToParent = config.offsetToParent ?? { x: 30, y: -30 };
  }

  override draw(): void {
    decoratorDraw(this);
  }

  override onAddInit(): void {
    const dec = this.decoratedNode;
    if (dec) {
      const isSupertoken = dec.gameNode?.data?.is_supertoken === true;
      if (!isSupertoken) {
        this.offsetToParent = {
          x: dec.width / 2 - 11,
          y: -(dec.height / 2 - 11),
        };
      } else {
        this.offsetToParent = {
          x: dec.width / 2 - 16,
          y: -(dec.height / 2 - 16),
        };
      }
    }
    if (this.clickable) {
      this.setClickable(true);
    }
    this.initUI();
    this.updateRenderProp();
    this.draw();
  }

  initUI(): void {
    this.on('vclick', (e) => {
      e.stopPropagation();
      if (this.decoratedNode) {
        this.decoratedNode.trigger('vclick');
      }
    });
  }
}

RenderDecoratorGear.prototype.decoType = 'DecoratorGear';

// ── DecoratorTimer ──────────────────────────────────────────────────────────

const FRAME_TIMER_DEFAULT: SpriteFrameMap = {
  normal: { x: 0, y: 580, width: 35, height: 35, pivotx: 18, pivoty: 18 },
};

export type DecoratorTimerConfig = SpriteConfig & {
  offsetToParent?: { x: number; y: number };
  serverTime?: number;
  serverStartTime?: number;
  duration?: number;
};

export class RenderDecoratorTimer extends RenderSprite implements DecoratorBase {
  declare decoType: DecoType;
  offsetToParent: { x: number; y: number };
  serverTime: number;
  serverStartTime: number;
  duration: number;
  startTime: number;
  endTime: number;
  remainTime = 0;
  done = false;
  jdomelem2: JQueryDecoratorElem;
  domelem2: HTMLCanvasElement;
  jdomelem3: JQueryDecoratorElem;
  domelem3: HTMLElement;

  static readonly textReadyIn: () => string = () => i18n.gettext('Ready in') + ' ';

  constructor(config: DecoratorTimerConfig = {}) {
    const $ = getRenderJQuery('RenderDecorators');
    const jdomelem = $("<div class='DecoratorTimer'></div>");

    const frameMap = config.frameMap ?? FRAME_TIMER_DEFAULT;
    const serverTime = config.serverTime ?? 0;
    const serverStartTime = config.serverStartTime ?? 0;
    const duration = config.duration ?? 1000;
    const startTime = new Date().getTime() - (serverTime - serverStartTime);
    const endTime = startTime + duration;

    const jdomelem2 = $("<canvas class='DecoratorTimerCanvas'></canvas>");
    const jdomelem3 = $("<div class='DecoratorTimerText'>6:12:20</div>");
    if (config.width !== undefined && config.height !== undefined) {
      jdomelem2.attr('width', String(config.width));
      jdomelem2.attr('height', String(config.height));
    }
    jdomelem.append(jdomelem2);
    jdomelem.append(jdomelem3);

    super({
      ...config,
      frameSrc: config.frameSrc ?? 'MainSprites.png',
      frameMap,
      frame: config.frame ?? 'normal',
      clickable: true,
      width: frameMap.normal?.width,
      height: frameMap.normal?.height,
      jdomelem: jdomelem,
    } as SpriteConfig);

    this.serverTime = serverTime;
    this.serverStartTime = serverStartTime;
    this.duration = duration;
    this.startTime = startTime;
    this.endTime = endTime;
    this.jdomelem2 = jdomelem2;
    this.domelem2 = jdomelem2[0] as HTMLCanvasElement;
    this.jdomelem3 = jdomelem3;
    this.domelem3 = jdomelem3[0];
    this.offsetToParent = config.offsetToParent ?? { x: 30, y: -30 };
  }

  override onAddInit(): void {
    if (this.decoratedNode) {
      this.offsetToParent = {
        x: this.decoratedNode.width / 2 - 12,
        y: -(this.decoratedNode.height / 2 - 12),
      };
    }
    if (this.clickable) {
      this.setClickable(true);
    }

    // FIXME: Write own slower Timer Ticker
    RenderSlowTicker.addListener(this);

    this.initUI();
    this.updateRenderProp();
    this.draw();
  }

  initUI(): void {
    this.on('vmouseover', () => {
      this.jdomelem3.show();
      this.jdomelem3.hidden = false;
    });
    this.on('vmouseout', () => {
      this.jdomelem3.hide();
      this.jdomelem3.hidden = true;
    });
  }

  getPercentage(): number {
    const now = new Date().getTime();
    const timespan = this.endTime - this.startTime;
    this.remainTime = this.endTime - now;
    return (now - this.startTime) / (timespan / 100);
  }

  override draw(): void {
    if (!this.decoratedNode) return;
    if (this.hidden) return;
    const perc = this.getPercentage();
    this.setSize(this.getSize());
    this.setTransform(this.getTransform());
    this.setPosition({
      x: this.decoratedNode.getPosition().x + this.offsetToParent.x,
      y: this.decoratedNode.getPosition().y + this.offsetToParent.y,
    });
    this.setOpacity(this.opacity);

    if (this.done) return;
    if (perc > 100) {
      RenderSlowTicker.removeListener(this);
      this.FXSnooze();
      this.done = true;
      this.decoratedNode.trigger('TimerEnd');
    }

    // Add some ms to make Countdown shortly show 00:00
    if (!this.jdomelem3.hidden) {
      this.jdomelem3.text(RenderDecoratorTimer.textReadyIn() + toTime(this.remainTime + 800));
    }

    const canvas = this.domelem2;
    canvas.width = this.getSize().width;
    canvas.height = this.getSize().height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.beginPath();
    ctx.lineWidth = 6;
    ctx.arc(
      this.offsetX,
      this.offsetY,
      14,
      270 * (Math.PI / 180),
      270 * (Math.PI / 180) + perc * 3.6 * (Math.PI / 180),
      false
    );
    ctx.strokeStyle = 'rgba(127, 49, 135, 1)';
    ctx.stroke();
  }
}

RenderDecoratorTimer.prototype.decoType = 'DecoratorTimer';

// ── DecoratorAmount ─────────────────────────────────────────────────────────

const FRAME_AMOUNT_DEFAULT: SpriteFrameMap = {
  normal: { x: 267, y: 582, width: 80, height: 16, pivotx: 38, pivoty: 4 },
};

export type DecoratorAmountConfig = SpriteConfig & {
  offsetToParent?: { x: number; y: number };
  amount?: number;
  text?: string;
};

export class RenderDecoratorAmount extends RenderSprite implements DecoratorBase {
  declare decoType: DecoType;
  offsetToParent: { x: number; y: number };
  amount: number;
  declare text: string;
  jdomelem2: JQueryDecoratorElem;
  jdomelem3: JQueryDecoratorElem;

  constructor(config: DecoratorAmountConfig = {}) {
    const $ = getRenderJQuery('RenderDecorators');
    const jdomelem = $("<div class='DecoratorAmount'></div>");
    const jdomelem2 = $("<div class='DecoratorAmountValue'></div>");
    const jdomelem3 = $("<div class='DecoratorAmountNum'></div>");
    jdomelem.append(jdomelem2);
    jdomelem.append(jdomelem3);

    super({
      ...config,
      frameSrc: 'MainSprites.png',
      frameMap: FRAME_AMOUNT_DEFAULT,
      frame: 'normal',
      jdomelem: jdomelem,
    } as SpriteConfig);

    this.offsetToParent = { x: 0, y: 35 };
    this.amount = config.amount ?? 0;
    this.text = config.text ?? 'Label';
    this.jdomelem2 = jdomelem2;
    this.jdomelem3 = jdomelem3;
    this.setAmount();
  }

  setAmount(amount?: number): void {
    const a = amount ?? this.amount;
    this.jdomelem2.animate({ width: Math.round((a / 100) * 60) }, 600);
    const dec = this.decoratedNode;
    const inc = (dec?.gameNode?.data?.absoluteInc as number | undefined) ?? 0;
    if (inc > 0) {
      this.jdomelem3.text(toKSNum(inc));
      this.jdomelem3.show();
    } else {
      this.jdomelem3.hide();
    }
  }

  override onAddInit(): void {
    if (this.decoratedNode) {
      this.offsetToParent = {
        x: 0,
        y: this.decoratedNode.height - this.decoratedNode.offsetY - 8,
      };
    }
    this.updateRenderProp();
    this.draw();
  }

  override draw(): void {
    decoratorDraw(this);
  }
}

RenderDecoratorAmount.prototype.decoType = 'DecoratorAmount';
