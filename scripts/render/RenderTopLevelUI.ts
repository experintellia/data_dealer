// Render-side top-level UI containers — the six classes (plus one
// helper) that bolt onto the Stage above the perp surface and host
// the chrome / popups / queue / score widgets:
//
//   - `RenderStatusbar` — the cash / AP / XP / karma / profiles HUD
//     bar.  Owns the silent-vs-FX update split (silent = `render()`
//     once, no Tween queue churn) and the AP-tooltip "More Energy
//     in N" loop.
//   - `RenderStatusItem` — the stripe-sprite child each Statusbar
//     icon mounts itself on top of (extends Sprite).
//   - `RenderDBQueue` — the bottom-of-stage profile-set queue with
//     its merge animation choreography (`FXMerge`) and bling-queue
//     callbacks.
//   - `RenderPopup` — the modal popup container with its big body
//     of delegated event wiring (close / no_cash / no_AP / error /
//     tab switching / sub-pop nav / pagination / token-seen /
//     buy-slots num control / tutorial advance).
//   - `RenderMissionPerp` — mission-card render with state-driven
//     `active` / `complete` / hidden styling.
//   - `RenderTopscorePerp` — leaderboard cell with rank + list
//     render hooks.
//
// Plus the small template helper:
//
//   - `renderAmountHtml(amount, frame, upgradeAmount, upgradeAbsAmount)` —
//     legacy `var RenderAmount = function(...)` IIFE-local that
//     returns a `<div class='DecoratorAmount'>` HTML string for
//     the upgrade preview popups.  Lives in this module since the
//     remaining inline call site (none — the helper is only
//     surfaced via the `_.mixin({ RenderAmount })` registration
//     below) and the shared sprite-tile lookup live together.
//
// Subclass-supplied jdomelem precedence: every parent in this file
// uses `config.jdomelem ?? <default>` so subclass `<div class='X'>`
// wrappers survive `super()`.  This pattern was established by
// PR #221 (RenderSprite/RenderText) and PR #223 (RenderStage); the
// reviewer flagged it as worth a header-level note.

import { h, render as preactRender } from 'preact';
import appModule from '../app.js';
import { MissionCard } from '../components/MissionCard.js';
import { span, sprintf, toKSNum, toTime } from '../dd-helpers.js';
import { buildMissionCardProps } from '../game/missionView.js';
import i18n from '../i18n.js';
import setup from '../setup.js';
import { type NodeConfig, RenderNode } from './RenderNode.js';
import { RenderSprite, type SpriteConfig, type SpriteFrameMap } from './RenderSprite.js';
import { type JQueryRenderElem, type JQueryRenderEvent, getRenderJQuery } from './_jqueryShim.js';
import { renderSpriteHtml } from './renderSpriteHelper.js';

// ── jQuery surface ──────────────────────────────────────────────────────────

type JQueryUIElem = JQueryRenderElem;
type UIEventLike = JQueryRenderEvent;

interface AppLike {
  renderView(viewName: string, data?: unknown): string;
  game?: {
    renderNode?: { getSize(): { width: number; height: number } };
  };
}

function getApp(): AppLike {
  return appModule.getApplication() as unknown as AppLike;
}

// ── shared structural surfaces ──────────────────────────────────────────────

interface StatusbarValueChannel {
  val: number;
  max: number;
  barsize: number;
}

interface StatusbarProfilesChannel extends StatusbarValueChannel {
  crosssum: number;
  tokenslength: number;
  tokenslengthmax: number;
}

// ── Statusbar ───────────────────────────────────────────────────────────────

export type StatusbarConfig = NodeConfig & {
  profiles?: StatusbarProfilesChannel;
  cash?: StatusbarValueChannel;
  AP?: StatusbarValueChannel;
  karma?: StatusbarValueChannel & { intensity?: number };
  XP?: StatusbarValueChannel & { level: number };
};

export class RenderStatusbar extends RenderNode {
  declare profiles: StatusbarProfilesChannel;
  declare cash: StatusbarValueChannel;
  declare AP: StatusbarValueChannel;
  declare karma: StatusbarValueChannel & { intensity?: number };
  declare XP: StatusbarValueChannel & { level: number };

  // Flat scalars derived from the channel objects above — these are
  // what the .html template reads, and they're what `FXSimpleCue`
  // tweens against during animated updates.
  profiles_val = 0;
  profiles_max = 0;
  profiles_barsize = 0;
  profiles_crosssum = 0;
  profiles_tokenslength = 0;
  profiles_tokenslengthmax = 0;
  profiles_active = 0;
  cash_val = 0;
  cash_active = 0;
  AP_val = 0;
  AP_max = 0;
  AP_barsize = 0;
  AP_active = 0;
  karma_val = 0;
  karma_max = 0;
  karma_intensity = 0;
  karma_barsize = 0;
  karma_active = 0;
  XP_val = 0;
  XP_max = 0;
  XP_level = 0;
  XP_barsize = 0;
  XP_active = 0;

  loop?: number;
  autoLoop?: number;

  declare template: string;
  static readonly textMoreIn: () => string = () => i18n.gettext('More Energy in') + ' ';

  static {
    const p = RenderStatusbar.prototype;
    p.template = 'statusbar.html';
    p.width = 720;
    p.height = 25;
    p.y = 12;
    p.z = 10000;
    p.offsetX = 720 / 2;
    p.offsetY = 0;
  }

  constructor(config: StatusbarConfig = {}) {
    const $ = getRenderJQuery('RenderTopLevelUI');
    const jdomelem = (config.jdomelem ?? $("<div class='Statusbar'></div>")) as JQueryUIElem;
    super({ ...config, jdomelem: jdomelem });

    if (this.profiles) {
      this.profiles_val = this.profiles.val;
      this.profiles_max = this.profiles.max;
      this.profiles_barsize = this.profiles.barsize;
      this.profiles_crosssum = this.profiles.crosssum;
      this.profiles_tokenslength = this.profiles.tokenslength;
      this.profiles_tokenslengthmax = this.profiles.tokenslengthmax;
    }
    if (this.cash) this.cash_val = this.cash.val;
    if (this.AP) {
      this.AP_val = this.AP.val;
      this.AP_max = this.AP.max;
      this.AP_barsize = this.AP.barsize;
    }
    if (this.karma) {
      this.karma_val = this.karma.val;
      this.karma_max = this.karma.max;
      this.karma_barsize = this.karma.barsize;
    }
    if (this.XP) {
      this.XP_val = this.XP.val;
      this.XP_max = this.XP.max;
      this.XP_level = this.XP.level;
      this.XP_barsize = this.XP.barsize;
    }

    this.initUI();
    // FIXME: data should be referenced to serverdata
  }

  override onAddInit(): void {
    this.updateRenderProp();
    this.render();
  }

  override draw(): void {
    this.setSize(this.getSize());
    this.setTransform(this.getTransform());
    this.setPosition(this.getPosition());
    this.setOpacity(this.opacity);
  }

  render(): void {
    if (this.parentNode) {
      this.x = this.parentNode.getSize().width / 2;
    }
    const jq = this.jdomelem;
    jq.empty();
    const html = getApp().renderView(this.template, this);
    jq.append(html);
    this.draw();

    // Mirror to the MainMenu's mobile XP slot (CSS hides it on desktop).
    const groot = this.gameNode?.GameRoot;
    if (groot?.renderMenu?.renderXP) {
      groot.renderMenu.renderXP(this);
    }

    // Keep refill timer always visible when AP is empty (no hover needed on mobile).
    this.refreshAPRemainIfEmpty();
  }

  override tick(): void {
    this.render();
  }

  // Silent paths bypass the Tween machinery: we just assign the flat
  // template props and re-render once. FXSimpleCue with dur=0 still
  // queues a Ticker listener and chains onto any active tween, so
  // letting silent updateGameValues run through it would grow the
  // tween queue under bursty silent traffic.
  FXUpdateAP(silent?: boolean): void {
    this.AP_val = this.AP.val;
    if (silent) {
      this.AP_active = 0;
      this.AP_max = this.AP.max;
      this.AP_barsize = this.AP.barsize;
      this.render();
      return;
    }
    this.AP_active = 1;
    this.FXSimpleCue(
      { AP_active: 0, AP_max: this.AP.max, AP_barsize: this.AP.barsize },
      250,
      'linear'
    );
  }

  FXUpdateXP(silent?: boolean): void {
    this.XP_level = this.XP.level;
    this.XP_val = this.XP.val;
    if (silent) {
      this.XP_active = 0;
      this.XP_barsize = this.XP.barsize;
      this.render();
      return;
    }
    this.XP_active = 1;
    this.FXSimpleCue({ XP_active: 0, XP_barsize: this.XP.barsize }, 250, 'linear');
  }

  FXUpdateCash(silent?: boolean): void {
    if (silent) {
      this.cash_active = 0;
      this.cash_val = this.cash.val;
      this.render();
      return;
    }
    this.cash_active = 1;
    this.FXSimpleCue({ cash_active: 0, cash_val: this.cash.val }, 250, 'linear');
  }

  FXUpdateKarma(silent?: boolean): void {
    if (silent) {
      this.karma_active = 0;
      this.karma_val = this.karma.val;
      this.karma_barsize = this.karma.barsize;
      this.render();
      return;
    }
    this.karma_active = 1;
    this.FXSimpleCue(
      {
        karma_active: 0,
        karma_val: this.karma.val,
        karma_barsize: this.karma.barsize,
      },
      250,
      'linear'
    );
  }

  FXUpdateProfiles(silent?: boolean): void {
    if (silent) {
      this.profiles_active = 0;
      this.profiles_val = this.profiles.val;
      this.profiles_barsize = this.profiles.barsize;
      this.profiles_crosssum = this.profiles.crosssum;
      this.profiles_tokenslength = this.profiles.tokenslength;
      this.render();
      return;
    }
    this.profiles_active = 1;
    this.FXSimpleCue(
      {
        profiles_active: 0,
        profiles_val: this.profiles.val,
        profiles_barsize: this.profiles.barsize,
        profiles_crosssum: this.profiles.crosssum,
        profiles_tokenslength: this.profiles.tokenslength,
      },
      500,
      'linear'
    );
  }

  startLoop(func: () => void, time = 1000): void {
    if (this.loop) {
      window.clearTimeout(this.loop);
    }
    if (func) func();
    this.loop = window.setTimeout(() => {
      this.startLoop(func, time);
    }, time);
  }

  stopLoop(): void {
    if (this.loop) {
      window.clearTimeout(this.loop);
    }
  }

  startAutoLoop(func: () => void, time = 1000): void {
    if (this.autoLoop) {
      window.clearTimeout(this.autoLoop);
    }
    if (func) func();
    this.autoLoop = window.setTimeout(() => {
      this.startAutoLoop(func, time);
    }, time);
  }

  stopAutoLoop(): void {
    if (this.autoLoop) {
      window.clearTimeout(this.autoLoop);
      delete this.autoLoop;
    }
  }

  /** Shows the "More Energy in …" refill timer permanently when AP is 0
   *  (no hover required — essential for mobile). Called at the end of
   *  every render() so the newly-created DOM always reflects AP state. */
  refreshAPRemainIfEmpty(): void {
    if (this.AP_val > 0) {
      this.stopAutoLoop();
      return;
    }
    const groot = this.gameNode?.GameRoot;
    if (!groot) return;
    const APT = groot.APTicker;
    if (!APT) return;
    const jq = this.jdomelem;
    const $ = getRenderJQuery('RenderTopLevelUI');
    this.startAutoLoop(() => {
      // Look up .StatusRemain each fire: render() calls jq.empty() between ticks,
      // so the element captured at startAutoLoop time would be stale.
      const jtext = jq.find('.StatusRemain');
      jtext.show();
      jtext.html(RenderStatusbar.textMoreIn() + span(toTime(APT.getRemainingTime?.() ?? 0)));
    }, 1000);
  }

  initUI(): void {
    const node = this;
    const $ = getRenderJQuery('RenderTopLevelUI');
    const jq = node.jdomelem;

    jq.on('click touchend', '.StatusItem', function (this: HTMLElement, e: UIEventLike) {
      e.stopPropagation();
      // On a touchscreen the browser dispatches BOTH `touchend` and a
      // synthesised `click` ~7 ms later at the same coordinate.  The
      // handler runs on touchend, opens the popup, and the synthesised
      // click then hits the just-mounted `.PopupContainer.lockOn`
      // overlay — which `dialogManager.handleInteraction` treats as a
      // backdrop tap and closes the popup we just opened.  Calling
      // `preventDefault()` on the touchend (per W3C touch-events spec)
      // suppresses the synthesised mouse event chain at the source, so
      // no stale click can sneak through.  No-op on the desktop click
      // branch — there is no synthesised event to suppress.
      if (e.type === 'touchend') {
        e.preventDefault();
      }
      const statusid = $(this).attr('data-status-id') as string | undefined;
      node.trigger('click_status.' + (statusid ?? ''));
    });

    jq.on('mouseenter', '.StatusItem.AP', function (this: HTMLElement, e: UIEventLike) {
      e.stopPropagation();
      const groot = node.gameNode?.GameRoot;
      if (!groot) return;
      if (groot.ap_value >= groot.xp_level.ap_max) {
        return;
      }
      const jtext = $(this).find('.StatusRemain');
      jtext.show();
      const APT = groot.APTicker;
      node.startLoop(() => {
        jtext.html(RenderStatusbar.textMoreIn() + span(toTime(APT?.getRemainingTime?.() ?? 0)));
      }, 1000);
    });

    jq.on('mouseleave', '.StatusItem.AP', function (this: HTMLElement, e: UIEventLike) {
      e.stopPropagation();
      const groot = node.gameNode?.GameRoot;
      if (groot && groot.ap_value === 0) return;
      node.stopLoop();
      const jtext = $(this).find('.StatusRemain');
      jtext.hide();
    });
  }
}

// ── StatusItem ──────────────────────────────────────────────────────────────

const STATUS_ITEM_DEFAULT_FRAMEMAP: SpriteFrameMap = {
  normal: { x: 36, y: 580, width: 128, height: 25, pivotx: 0, pivoty: 0 },
};

export type StatusItemConfig = SpriteConfig;

export class RenderStatusItem extends RenderSprite {
  constructor(config: StatusItemConfig = {}) {
    const $ = getRenderJQuery('RenderTopLevelUI');
    const jdomelem = $("<div class='StatusItem'></div>");
    super({
      ...config,
      frameSrc: config.frameSrc ?? 'MainSprites.png',
      frameMap: config.frameMap ?? STATUS_ITEM_DEFAULT_FRAMEMAP,
      frame: 'normal',
      jdomelem: jdomelem,
    } as SpriteConfig);
  }
}

// ── DBQueue ─────────────────────────────────────────────────────────────────

export type DBQueueConfig = NodeConfig;

export class RenderDBQueue extends RenderNode {
  declare template: string;
  declare textProfilesNew: () => string;
  declare textUpdated: () => string;

  static {
    const p = RenderDBQueue.prototype;
    p.template = 'db_queue.html';
    p.width = 720;
    p.height = 100;
    p.z = 10;
    p.offsetX = 720 / 2;
    p.offsetY = -58;
    p.textProfilesNew = () => i18n.gettext('%s New');
    p.textUpdated = () => i18n.gettext('%s Updated');
  }

  constructor(config: DBQueueConfig = {}) {
    const $ = getRenderJQuery('RenderTopLevelUI');
    const jdomelem = (config.jdomelem ?? $("<div class='DatabaseQueue'></div>")) as JQueryUIElem;
    super({ ...config, jdomelem: jdomelem });

    const node = this;
    const jq = node.jdomelem;
    jq.off();

    jq.on('click touchend', '.Button:not(.disabled)[data-button-id="DatabaseUpgrades"]', (e) => {
      e.stopPropagation();
      e.preventDefault();
      node.trigger('select_upgrades');
    });

    jq.on(
      'click touchend',
      '.DatabaseQueueItem:not(.disabled)',
      function (this: HTMLElement, e: UIEventLike) {
        e.stopPropagation();
        e.preventDefault();
        const psid = $(this).attr('data-psid') as string | undefined;
        jq.find('.DatabaseQueueItem').removeClass('selected');
        $(this).addClass('selected');
        if (e.shiftKey) {
          node.trigger('profileset_shift_click', [psid]);
        } else {
          node.trigger('profileset_click', [psid]);
        }
      }
    );

    node.on('mousedown touchstart', (e) => {
      const offset = jq.offset();
      if (offset) {
        node.userClickAbsPos = {
          x: (e.pageX ?? 0) - offset.left,
          y: (e.pageY ?? 0) - offset.top,
        };
      }
    });
  }

  override onAddInit(): void {
    this.updateRenderProp();
    this.render();
  }

  FXMerge(psid: string, inc: number, dup: number, wait: number): void {
    const $ = getRenderJQuery('RenderTopLevelUI');
    void $;
    const jq = this.jdomelem;
    const ps = jq.find('.DatabaseQueueItem[data-psid=' + psid + ']');
    const after = ps.nextAll('.DatabaseQueueItem');
    ps.addClass('disabled');
    this.FXBlingQueue({
      text: sprintf(this.textProfilesNew(), toKSNum(inc)),
      wait: 200,
      extendClass: 'ProfileBlingNew',
    });
    this.FXBlingQueue({
      text: sprintf(this.textUpdated(), toKSNum(dup)),
      wait: 500,
      extendClass: 'ProfileBlingUpdated',
    });
    window.setTimeout(() => {
      ps.addClass('merging');
    }, 200);
    window.setTimeout(() => {
      ps.animate({ top: '102' }, 250, () => {
        let del = 0;
        after.each(function (this: HTMLElement) {
          const $this = getRenderJQuery('RenderTopLevelUI')(this);
          $this.animate({ left: '-=100' }, 250 + del);
          del += 50;
        });
        ps.remove();
      });
    }, 2000 + wait);
  }

  override draw(): void {
    this.setSize(this.getSize());
    this.setTransform(this.getTransform());
    this.setPosition(this.getPosition());
    this.setOpacity(this.opacity);
  }

  render(): void {
    if (this.parentNode?.parentNode) {
      this.x = this.parentNode.parentNode.getSize().width / 2;
      this.y = this.parentNode.parentNode.getSize().height - this.height;
    }
    const jq = this.jdomelem;
    jq.empty();
    const html = getApp().renderView(this.template, this);
    jq.append(html);
    this.draw();
    this.fitMobileConveyor();
  }

  /**
   * Scale the mobile conveyor so the fixed 520-px belt box fills the
   * viewport width (matching the desktop belt's width-filling look).
   *
   * The mobile CSS (`@media (max-width: 926px)`) does this with
   * `transform: scale(<ratio>)`, but a *responsive* ratio needs
   * `length / length` calc division — `(100vw - 24px) / 520px` — which
   * Firefox and older Android WebView reject.  There the belt collapses to
   * the static CSS fallback size and, because of `transform-origin: bottom
   * left`, hugs the left edge instead of centring.  Compute the exact
   * ratio here so every engine renders the same width-filling belt.
   * Mirrors the CSS `clamp(0.4, (100vw - 24px) / 520, 1)`; the 926-px gate
   * matches the media-query breakpoint that owns the mobile layout, and
   * above it we clear the inline value so the desktop layout (no scale)
   * applies.
   */
  private fitMobileConveyor(): void {
    const root = this.jdomelem[0];
    const conv = root?.querySelector('.DatabaseQueueConveyor') as HTMLElement | null;
    if (!conv) return;
    const vw = window.innerWidth;
    if (vw <= 926) {
      const s = Math.min(1, Math.max(0.4, (vw - 24) / 520));
      conv.style.transform = `scale(${s})`;
      conv.style.transformOrigin = 'bottom left';
    } else {
      conv.style.transform = '';
      conv.style.transformOrigin = '';
    }
  }

  override tick(): void {
    this.render();
  }
}

// ── Popup ───────────────────────────────────────────────────────────────────

interface PopupContainerLike {
  renderNode: RenderNode & {
    popupContainerDomelem?: JQueryRenderElem;
  };
  lock?(): void;
  unlock?(): void;
}

// ── MissionPerp ─────────────────────────────────────────────────────────────

export type MissionPerpConfig = NodeConfig & {
  frameSrc?: string;
  frameMap?: SpriteFrameMap;
  frame?: string;
};

export class RenderMissionPerp extends RenderNode {
  declare frameSrc: string | undefined;
  declare frameMap: SpriteFrameMap | undefined;
  declare frame: string;

  constructor(config: MissionPerpConfig = {}) {
    const $ = getRenderJQuery('RenderTopLevelUI');
    const jdomelem = (config.jdomelem ?? $("<div class='MissionPerp'></div>")) as JQueryUIElem;
    super({
      ...config,
      position: 'relative',
      display: 'block',
      clickable: true,
      jdomelem: jdomelem,
    });
    this.frame = config.frame ?? 'normal';
    this.draw();
  }

  override onAddInit(): void {
    if (this.clickable) {
      this.setClickable(true);
    }
    this.updateRenderProp();
    this.render();
    this.initUI();
  }

  // FIXME: maybe adapt to allow transforms
  override setPosition(_pos?: { x: number; y: number }): void {
    return;
  }

  override setTransform(_transf?: {
    scaleX?: number;
    scaleY?: number;
    transX?: number;
    transY?: number;
    rotate?: number;
  }): void {
    return;
  }

  // Stub: sizing is CSS-driven.  The inherited Node.setSize would
  // otherwise write inline `width: 0px; height: 0px` (Node prototype
  // defaults) and override the CSS width.
  override setSize(_size?: { width?: number; height?: number }): void {
    return;
  }

  render(): void {
    const jq = this.jdomelem;
    jq.removeClass('active');
    jq.removeClass('complete');
    const states = this.gameNode?.states;
    if (states?.active) {
      jq.addClass('active');
    }
    if (states?.complete) {
      jq.addClass('complete');
    }
    if (!states?.complete && !states?.active) {
      this.hide();
    } else {
      this.show();
    }
    // Preact owns the `.MissionPerp` node's children — no `jq.empty()`
    // (that would desync Preact's vdom; re-renders are diffed in place,
    // unmounted in `remove()`).  Goal/reward view-models are shared
    // with `MissionPopup` via `buildMissionCardProps` (missionView.ts).
    const el = this.jdomelem[0];
    if (el) {
      const groot = this.gameNode?.GameRoot;
      const props = buildMissionCardProps({
        data: this.gameNode?.data ?? {},
        getType: (g) => groot?.getType(g),
        getTypeData: (g) => groot?.getTypeData(g),
      });
      preactRender(h(MissionCard, props), el);
    }
    this.draw();
  }

  override remove(): void {
    const el = this.jdomelem?.[0];
    if (el) {
      preactRender(null, el);
    }
    super.remove();
  }

  override draw(): void {
    this.setSize(this.getSize());
    this.setTransform(this.getTransform());
    this.setPosition(this.getPosition());
    this.setOpacity(this.opacity);
  }

  override tick(): void {
    this.render();
  }

  initUI(): void {
    this.on('vclick', (e) => {
      e.stopPropagation();
    });
    this.on('states', (e) => {
      e.stopPropagation();
      this.render();
    });
    this.on('states_active', (e) => {
      e.stopPropagation();
    });
  }
}

// ── TopscorePerp ────────────────────────────────────────────────────────────

export type TopscorePerpConfig = NodeConfig & {
  frameSrc?: string;
  frameMap?: SpriteFrameMap;
  frame?: string;
};

// Topscore-specific gameNode shape: the `Topscore` GameNode subclass
// owns a `scoretype` field (Topscore.ts).  Shadow-declared on the
// render-side `gameNode` field so the rank/list templates can read
// it without the residual `as unknown as` cast.  Mirrors the
// (unexported) `GameNodeLike` in RenderNode.ts plus `scoretype`.
interface TopscoreGameNodeLike {
  trigger(ev: string, params?: unknown[]): void;
  parentNode?: { renderNode: RenderNode; data?: Record<string, unknown> };
  states?: Record<string, boolean>;
  data?: Record<string, unknown>;
  scoretype?: string;
}

export class RenderTopscorePerp extends RenderNode {
  declare frameSrc: string | undefined;
  declare frameMap: SpriteFrameMap | undefined;
  declare frame: string;
  declare template: string;
  // Shadow the inherited `gameNode: GameNodeLike | undefined` with a
  // Topscore-specific shape so renderRank/renderList can read
  // `scoretype` without a cast.
  declare gameNode: TopscoreGameNodeLike | undefined;

  static {
    RenderTopscorePerp.prototype.template = 'topscore.html';
  }

  constructor(config: TopscorePerpConfig = {}) {
    const $ = getRenderJQuery('RenderTopLevelUI');
    const jdomelem = (config.jdomelem ?? $("<div class='TopscorePerp'></div>")) as JQueryUIElem;
    super({
      ...config,
      position: 'relative',
      hidden: true,
      clickable: true,
      jdomelem: jdomelem,
    });
    this.frame = config.frame ?? 'normal';
    this.draw();
  }

  override onAddInit(): void {
    if (this.clickable) {
      this.setClickable(true);
    }
    this.updateRenderProp();
    this.render();
    this.initUI();
  }

  override setPosition(_pos?: { x: number; y: number }): void {
    return;
  }

  override setTransform(_transf?: {
    scaleX?: number;
    scaleY?: number;
    transX?: number;
    transY?: number;
    rotate?: number;
  }): void {
    return;
  }

  render(): void {
    const jq = this.jdomelem;
    jq.empty();
    const html = getApp().renderView(this.template, this);
    jq.append(html);
    this.draw();
  }

  override draw(): void {
    if (this.hidden) {
      this.hide();
    }
    this.setOpacity(this.opacity);
  }

  override tick(): void {
    this.render();
  }

  initUI(): void {
    this.on('vclick', (e) => {
      e.stopPropagation();
      const parent = this.parentNode;
      if (parent) {
        parent.jdomelem.find('.TopscorePerp').removeClass('active');
      }
    });
    this.on('states', (e) => {
      e.stopPropagation();
      this.render();
    });
    this.on('states_active', (e) => {
      e.stopPropagation();
    });
  }

  renderRank(): void {
    const jq = this.jdomelem;
    const rank = jq.find('.TopscoreRank');
    rank.empty();
    const gnode = this.gameNode;
    const html = getApp().renderView('topscore_rank.html', {
      data: gnode?.data,
      parentdata: gnode?.parentNode?.data,
      type: gnode?.scoretype,
    });
    rank.append(html);
  }

  renderList(): void {
    const jq = this.jdomelem;
    const list = jq.find('.TopscoreList');
    list.empty();
    const gnode = this.gameNode;
    const html = getApp().renderView('topscore_list.html', {
      data: gnode?.data,
      parentdata: gnode?.parentNode?.data,
      type: gnode?.scoretype,
    });
    list.append(html);
  }
}

// ── renderAmountHtml helper ─────────────────────────────────────────────────

const AMOUNT_FRAMEMAP: SpriteFrameMap = {
  normal: { x: 267, y: 582, width: 80, height: 16, pivotx: 0, pivoty: -69 },
  consumed: { x: 187, y: 582, width: 80, height: 16, pivotx: 0, pivoty: -69 },
};

/** Builds a `<div class='DecoratorAmount'>` HTML string showing the
 *  current `amount` as a 60px-wide value bar, with optional
 *  `upgradeAmount` overlay and `upgradeAbsAmount` numeric readout.
 *  Used by the powerup-upgrade preview templates. */
export function renderAmountHtml(
  amount: number | undefined,
  frame?: string,
  upgradeAmount?: number,
  upgradeAbsAmount?: number
): string {
  const $ = getRenderJQuery('RenderTopLevelUI');

  const frameSrc = 'MainSprites.png';
  const activeFrame = frame || 'normal';
  const map = AMOUNT_FRAMEMAP[activeFrame];
  if (!map) return '';

  const jdomelem = $("<div class='DecoratorAmount'></div>");
  const jdomelem2 = $("<div class='DecoratorAmountValue'></div>");
  jdomelem.append(jdomelem2);
  if (frame) {
    jdomelem.addClass(frame);
  }
  jdomelem.css({
    'background-image': 'url(' + setup.imagePathPrefix + frameSrc + ')',
  });
  jdomelem.width(map.width);
  jdomelem.height(map.height);
  jdomelem.css({
    left: -map.pivotx,
    top: -map.pivoty,
  });
  const domelem = jdomelem[0];
  domelem.style.backgroundPosition = -map.x + 'px ' + -map.y + 'px';
  const a = amount ?? 0;
  jdomelem2.width(Math.round((a / 100) * 60));
  if (upgradeAmount !== undefined) {
    if (a > 0) {
      jdomelem.addClass('hasUpgrade');
    }

    const jdomelem4 = $("<div class='DecoratorAmountUpgrade'></div>");
    jdomelem4.width(Math.round((upgradeAmount / 100) * 60));
    jdomelem4.css({ left: 9 + Math.round((a / 100) * 60) + 'px' });
    jdomelem.append(jdomelem4);

    if (upgradeAmount < 25 && upgradeAbsAmount !== undefined) {
      const jdomelem3 = $("<div class='DecoratorAmountNum'></div>");
      jdomelem3.text(toKSNum(upgradeAbsAmount));
      jdomelem.append(jdomelem3);
    }
  }

  // Match the legacy outerHTML extraction (clone-into-wrapper-then-html)
  // rather than `domelem.outerHTML` — preserves any attribute ordering
  // quirks downstream consumers might rely on.
  const wrapper = $('<div>') as JQueryUIElem;
  wrapper.append(jdomelem.clone());
  return (wrapper.html() ?? '') as string;
}
