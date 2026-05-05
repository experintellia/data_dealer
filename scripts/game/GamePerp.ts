// GamePerp — shared base for the 10 perp subclasses (DatabasePerp,
// CityPerp, AgentPerp, ContactPerp, PusherPerp, ClientPerp, ProxyPerp,
// ProjectPerp, TokenPerp, SupertokenPerp).  Extracted from
// scripts/Game.js's IIFE in PR 11 of issue #147.
//
// The dynamic `Game[node.game_type]` lookup in BuyPerp is routed through
// scripts/game/perpRegistry.ts so GamePerp can land before the individual
// perp subclasses; PR 12+ extracts each subclass and migrates the
// registry consumers to direct imports.

import { getRender } from '../Render.js';
import appModule from '../app.js';
import i18n from '../i18n.js';
import { GameNode, getAllByGestalt, getByFirstId, getFirstId } from './GameNode.js';
import { mergeData } from './mergeData.js';
import { lookupPerpClass } from './perpRegistry.js';

// ---------------------------------------------------------------------------
// Local types
// ---------------------------------------------------------------------------

type CableType = 'in' | 'out' | 'inout';

interface RenderNodeLike {
  sticky?: boolean;
  cableTo?(target: unknown, opts: { mode: CableType }): void;
  cableAnimatedTo?(target: unknown, opts: { mode: CableType }, cb?: () => void): void;
  addDecorator?(deco: unknown): unknown;
  addPopup?(popup: unknown): void;
  hide?(): void;
  show?(): void;
  remove?(): void;
  getPosition?(): { x: number; y: number };
  getVectorTo?(target: unknown): unknown;
  getVectorPos?(vector: unknown, ratio: number): { x: number; y: number };
  parentNode?: { scrollTo?(pos: { x: number; y: number }): void };
  jdomelem?: unknown;
  FXSproing?(): void;
  FXNoCash?(): void;
  FXArise?(cb?: () => void): void;
  FXBounce?(): void;
  DecoratorNew?: { remove?(): void };
}

interface RenderPopupLike {
  open?: boolean;
  trigger(ev: string, args?: unknown[]): void;
  close(): void;
  remove?(): void;
}

interface TimerConf {
  duration: number;
  serverTime?: number;
  serverStart?: number;
}

interface GameRootForPerp {
  data: { status_icons?: unknown; [key: string]: unknown };
  IPerps: Record<string, true>;
  xp_level: { number: number; [key: string]: unknown };
  trigger(ev: string, args?: unknown[]): void;
  makeNotifications(data: Record<string, unknown>): void;
  updateGameValues(
    gv: Record<string, unknown>,
    levelup?: boolean,
    missions?: unknown,
    quiet?: boolean
  ): void;
  getType(
    gestalt?: string
  ):
    | { type_data?: Record<string, unknown>; game_type?: string; [key: string]: unknown }
    | undefined;
  getTypeData(gestalt?: string): Record<string, unknown> | undefined;
}

interface BuyPerpResult {
  game_values?: Record<string, unknown>;
  levelup?: boolean;
  missions?: unknown;
  node?: {
    game_id?: string;
    game_type?: string;
    full_path?: string;
    instance_data?: Record<string, unknown>;
  };
  error?: number;
}

interface DoneFailChain<T> {
  done(cb: (data: { result?: T }) => void): DoneFailChain<T>;
  fail(cb: (data: unknown) => void): DoneFailChain<T>;
}

/** Animation-singleton interface from Game.js's AniTicker. */
interface AniTickerLike {
  addListener(node: GamePerp): void;
  removeListener(node: GamePerp): void;
}

/** ProvidedPerp UI-row shape for the buy dialog (compileProvided). */
interface ProvidedPerpRow {
  gestalt: string;
  locked: boolean;
  data: Record<string, unknown> & {
    required_level?: number;
    required_providers?: string[];
    requiredProviders?: string[];
    [key: string]: unknown;
  };
}

// AniTicker is captured at GamePerp-class scope and injected by Game.js
// via `setAniTicker` (called once at IIFE-end, alongside setPerpClasses).
// Keeps GamePerp.ts free of the legacy AniTicker singleton's Game.js-side
// implementation.
let _aniTicker: AniTickerLike | null = null;
export function setAniTicker(ticker: AniTickerLike): void {
  _aniTicker = ticker;
}

// ---------------------------------------------------------------------------
// GamePerp class
// ---------------------------------------------------------------------------

export class GamePerp extends GameNode {
  cableType: CableType = 'in';
  labelClass?: string;
  sticky = true;
  popupTemplate = 'popup.html';
  textNewItems?: string;

  // Init flags carried across renders (legacy fields).
  _loadReady?: boolean;
  _loadTimer?: TimerConf;
  renderTimer?: { FXSproing?(): void } | undefined;

  // Subclass-stamped fields read by GamePerp methods.
  path?: string;
  noConnect?: boolean;
  popupTemplateData?: Record<string, unknown>;
  highlightTabs?: string[];

  // -------------------------------------------------------------------
  // Typed accessors (consolidated cast seam, per PR #177 review)
  // -------------------------------------------------------------------

  private get groot(): GameRootForPerp {
    return this.GameRoot as unknown as GameRootForPerp;
  }

  private get renderApi(): RenderNodeLike | undefined {
    return this.renderNode as RenderNodeLike | undefined;
  }

  private getRenderModule(): {
    Popup: new (cfg: unknown) => RenderPopupLike;
    DecoratorLabel: new (cfg: unknown) => unknown;
    DecoratorNew: new (cfg: unknown) => unknown;
    DecoratorTimer: new (cfg: unknown) => { FXSproing?(): void };
  } {
    return getRender() as unknown as {
      Popup: new (cfg: unknown) => RenderPopupLike;
      DecoratorLabel: new (cfg: unknown) => unknown;
      DecoratorNew: new (cfg: unknown) => unknown;
      DecoratorTimer: new (cfg: unknown) => { FXSproing?(): void };
    };
  }

  // -------------------------------------------------------------------
  // Render hooks
  // -------------------------------------------------------------------

  override extendRender(): void {
    const Render = this.getRenderModule();
    const render = this.renderData || {};
    const node = this.renderApi;
    if (!node) return;
    node.sticky = this.sticky;

    // TODO: Some mixed Renderer rules — review/rewrite and split up to
    // subclasses when we know how to better handle this.
    if (
      !this.noConnect &&
      this.renderType === 'Perp' &&
      this.parentNode &&
      this.parentNode.renderType === 'Perp'
    ) {
      const parentNode = this.parentNode.renderNode as RenderNodeLike | undefined;
      parentNode?.cableTo?.(node, { mode: this.cableType });
    }
    if (render.config?.label) {
      node.addDecorator?.(
        new Render.DecoratorLabel({
          text: render.config.label,
          extendClass: this.labelClass,
        })
      );
    }
    if (this._loadReady) {
      this.markReady?.();
      delete this._loadReady;
    } else if (this._loadTimer) {
      this.markTimer(this._loadTimer);
      delete this._loadTimer;
    }
  }

  markTimer(conf: TimerConf | undefined): boolean {
    if (!conf) return false;
    const Render = this.getRenderModule();
    this.setState('idle', false);
    this.setState('chargeRunning', true);
    this.renderTimer = this.renderApi?.addDecorator?.(
      new Render.DecoratorTimer({
        duration: conf.duration,
        serverTime: conf.serverTime,
        serverStartTime: conf.serverStart,
      })
    ) as { FXSproing?(): void } | undefined;
    this.renderTimer?.FXSproing?.();
    return true;
  }

  private static _stopProp(e: unknown): void {
    const fn = (e as { stopPropagation?: () => void } | null | undefined)?.stopPropagation;
    if (typeof fn === 'function') fn.call(e);
  }

  override initEventHandlers(): void {
    const gnode = this;
    const groot = this.groot;

    gnode.on('dragend', function (e: unknown) {
      GamePerp._stopProp(e);
      // FIXME: Testing Save Coords.
      const pos = (gnode.renderNode as RenderNodeLike | undefined)?.getPosition?.();
      if (gnode.path && pos) {
        groot.trigger('saveCoordsQueue', [gnode.path, pos]);
      }
    });
    gnode.on('vclick', GamePerp._stopProp);
    gnode.on('vdblclick', GamePerp._stopProp);

    gnode.on('after_buy after_create', function (e: unknown) {
      GamePerp._stopProp(e);
      const story = gnode.data && (gnode.data as { story?: unknown }).story;
      if (story) {
        groot.makeNotifications({ story: story, storyPerp: gnode });
      }
    });

    if (gnode.AniTick) {
      gnode.on('states_chargeRunning', function (e: unknown, state: unknown) {
        GamePerp._stopProp(e);
        if (state) {
          _aniTicker?.addListener(gnode);
        } else {
          _aniTicker?.removeListener(gnode);
        }
      });
    }

    if (this.extendEventHandlers) {
      this.extendEventHandlers();
    }
  }

  // -------------------------------------------------------------------
  // Popup helpers
  // -------------------------------------------------------------------

  updateTemplateData(): void {
    const groot = this.groot;
    // Popup instantiated for the first time
    if (!this.popupTemplateData) {
      const ptd: Record<string, unknown> = {};
      ptd.states = this.states;
      ptd.status_icons = groot.data.status_icons;
      const pd: Record<string, unknown> = {};
      if (this.gestalt !== undefined) pd.gestalt = this.gestalt;
      pd.id = this.id;
      ptd.data = pd;
      ptd.loading = true;
      ptd.groot = groot;
      this.popupTemplateData = ptd;
    }
    // Highlight tabs in popups.
    this.popupTemplateData.highlightTabs = this.highlightTabs || [];
    Object.assign(this.popupTemplateData.data as Record<string, unknown>, this.data || {});
    // FIXME: make this a getGameValues method on groot.
    this.popupTemplateData.game_values = {
      xp_level: groot.xp_level,
    };
  }

  private _buildPopup(replaceExisting: boolean): RenderPopupLike {
    const Render = this.getRenderModule();
    this.updateTemplateData();

    const popup = new Render.Popup({
      // FIXME: gameNode only used for debug info on logo click.
      gameNode: this,
      template: this.popupTemplate,
      templateData: this.popupTemplateData,
      popupContainer: this.ViewMap,
    });

    if (replaceExisting && this.renderPopup) {
      (this.renderPopup as RenderPopupLike).remove?.();
    }
    this.renderPopup = popup;

    const viewMapNode = this.ViewMap?.renderNode as RenderNodeLike | undefined;
    viewMapNode?.addPopup?.(popup);

    if (this.initPopupEvents) this.initPopupEvents();

    return popup;
  }

  openPopup(): RenderPopupLike {
    return this._buildPopup(false);
  }

  updatePopup(): RenderPopupLike {
    return this._buildPopup(true);
  }

  // -------------------------------------------------------------------
  // BuyPerp — server round-trip + new-perp creation
  // -------------------------------------------------------------------

  BuyPerp(bgestalt: string, placePos?: { x: number; y: number }): void {
    const gnode = this;
    const groot = this.groot;
    const Render = this.getRenderModule();
    const remote = appModule.getApplication().remote;
    const buyPerpFn = remote.buyPerp;
    if (!buyPerpFn) return;
    const path = gnode.path || '';
    const call = buyPerpFn(path, bgestalt) as unknown as DoneFailChain<BuyPerpResult>;
    call.done(function (data) {
      if (!data.result) {
        // Server Error
        gnode.Error?.('The computer says NOOOO', data);
        return;
      }
      const r = data.result;
      if (r.error !== undefined) {
        // Probably no cash (or proxy slots full).
        if (gnode.renderPopup && (gnode.renderPopup as RenderPopupLike).open) {
          if (r.error === 2) {
            gnode.renderPopup.trigger('no_cash');
          } else if (gnode.gameType === 'ProxyPerp' && r.error === 3) {
            gnode.renderPopup.trigger('error');
            groot.makeNotifications({
              simplemessage: { text: i18n.gettext('projectbuy_proxyslotsfull') },
            });
          } else {
            gnode.renderPopup.trigger('error');
          }
        } else {
          (gnode.renderNode as RenderNodeLike | undefined)?.FXNoCash?.();
        }
        return;
      }
      if (gnode.renderPopup) {
        gnode.renderPopup.trigger('popup_close');
      }
      if (!r.node) return;
      groot.updateGameValues(r.game_values || {}, r.levelup === true, r.missions);
      const node = r.node;
      const nodeGameType = node.game_type;
      if (!nodeGameType) return;
      const Ctor = lookupPerpClass(nodeGameType);
      if (!Ctor) return;
      const node_data = groot.getTypeData(bgestalt);
      const perp = new Ctor({
        id: node.game_id,
        gestalt: bgestalt,
        path: node.full_path,
        noConnect: true,
        data: mergeData(node_data, node.instance_data),
        // Render perps to first item in path (Imperium or Database).
        renderNodeParent: getFirstId('Imperium'),
        ViewMap: getByFirstId('Imperium'),
        gameType: nodeGameType,
      }) as GamePerp & {
        renderData: {
          config: {
            placeRandom?: { x: number; y: number };
            placeParentRadius?: number;
            hidden?: boolean;
          };
        };
        data: { contained_tokens?: unknown[]; provided_perps?: string[]; [key: string]: unknown };
      };
      gnode.addChild(perp);
      // FIXME: fishy but works?
      const gnodeRn = gnode.renderNode as RenderNodeLike | undefined;
      const parentRn = gnode.parentNode?.renderNode as RenderNodeLike | undefined;
      if (gnodeRn && parentRn) {
        const vector = parentRn.getVectorTo?.(gnodeRn);
        // Golden ratio.
        if (!placePos && vector) {
          const calced = gnodeRn.getVectorPos?.(vector, 0.61803398875);
          if (calced) {
            placePos = calced;
            perp.renderData.config.placeRandom = placePos;
            perp.renderData.config.placeParentRadius = 320;
          }
        }
      }

      if (placePos) perp.renderData.config.placeRandom = placePos;
      perp.renderData.config.placeParentRadius = 0;
      perp.renderData.config.hidden = true;

      perp.render();
      const perpRn = perp.renderNode as RenderNodeLike | undefined;
      const perpPos = perpRn?.getPosition?.();
      if (perp.path && perpPos) {
        groot.trigger('saveCoords', [perp.path, perpPos]);
      }
      perpRn?.addDecorator?.(
        new Render.DecoratorNew({ text: i18n.gettext('New!'), extendClass: 'NewPerp' })
      );
      perpRn?.hide?.();
      if (perpPos) perpRn?.parentNode?.scrollTo?.(perpPos);

      window.setTimeout(function () {
        perpRn?.FXArise?.(function () {
          gnodeRn?.cableAnimatedTo?.(perpRn, { mode: perp.cableType }, function () {
            if (perp.cableType === 'in') {
              perpRn?.FXBounce?.();
            } else if (perp.cableType === 'out') {
              gnodeRn?.FXBounce?.();
            } else {
              gnodeRn?.FXBounce?.();
              perpRn?.FXBounce?.();
            }
            if (perp.data.provided_perps && perp.data.provided_perps.length) {
              const n: { perps?: string[] } = {};
              if (perp.gameType === 'PusherPerp') {
                n.perps = perp.getProvidedByRequiredPerps();
              } else {
                n.perps = perp.getProvidedByLevel();
              }
              const thefirst = (perp.gestalt ? getAllByGestalt(perp.gestalt).length : 0) <= 1;
              if (thefirst) {
                groot.makeNotifications(n as Record<string, unknown>);
              } else {
                perp.markNewItems();
              }
            }
          });
        });
      }, 300);
      perp.trigger('after_buy');
    });
  }

  // FIXME DEBUG: testpopup for each gameperp (gets overwritten).
  override extendEventHandlers(): void {
    const gnode = this;
    this.on('vclick', function (e: unknown) {
      GamePerp._stopProp(e);
      gnode.openPopup();
    });
  }

  // -------------------------------------------------------------------
  // Provided-perps helpers (UI compile + new-item marking)
  // -------------------------------------------------------------------

  markNewItems(): void {
    /* FIXME? no decorator when max_slots is full?
       if (this.data && this.data.max_slots) {
         if (this.children.length >= this.data.max_slots) return;
       }
    */
    const Render = this.getRenderModule();
    const text = this.textNewItems || i18n.gettext('New Items!');
    this.renderApi?.addDecorator?.(new Render.DecoratorNew({ text: text, arrow: true }));
  }

  /** Walks `data.provided_perps`, skipping already-owned ones, and calls
   *  `match` on each gestalt whose `type_data` satisfies `predicate`. */
  private _walkProvided(
    predicate: (
      td: { required_providers?: string[]; required_level?: number } | undefined,
      groot: GameRootForPerp
    ) => boolean,
    match: (gestalt: string) => void
  ): void {
    const groot = this.groot;
    const provided = (this.data as { provided_perps?: string[] } | undefined)?.provided_perps || [];
    provided.forEach((gestalt) => {
      if (Object.prototype.hasOwnProperty.call(groot.IPerps, gestalt)) return;
      const td = groot.getType(gestalt)?.type_data as
        | { required_providers?: string[]; required_level?: number }
        | undefined;
      if (predicate(td, groot)) match(gestalt);
    });
  }

  private static _hasOwnedRequiredProvider(
    td: { required_providers?: string[] } | undefined,
    groot: GameRootForPerp
  ): boolean {
    return !!td?.required_providers?.some((p) =>
      Object.prototype.hasOwnProperty.call(groot.IPerps, p)
    );
  }

  checkProvidedByRequiredPerps(): void {
    this._walkProvided(GamePerp._hasOwnedRequiredProvider, () => this.markNewItems());
  }

  getProvidedByRequiredPerps(): string[] {
    const perps: string[] = [];
    this._walkProvided(GamePerp._hasOwnedRequiredProvider, (g) => perps.push(g));
    return perps;
  }

  checkProvidedByLevel(): void {
    this._walkProvided(
      (td, groot) => td?.required_level === groot.xp_level.number,
      () => this.markNewItems()
    );
  }

  getProvidedByLevel(): string[] {
    const perps: string[] = [];
    this._walkProvided(
      (td, groot) =>
        typeof td?.required_level === 'number' && td.required_level <= groot.xp_level.number,
      (g) => perps.push(g)
    );
    return perps;
  }

  compileProvided(): void {
    const groot = this.groot;
    const dataRec = this.data as {
      provided_perps?: string[];
      buyablePerps?: string[];
      providedPerps?: ProvidedPerpRow[];
    };
    dataRec.providedPerps = [];
    if (dataRec.buyablePerps === undefined) return;
    const buyable = new Set(dataRec.buyablePerps);
    const provided = dataRec.provided_perps || [];
    provided.forEach((p) => {
      // Already-owned perps shouldn't appear in the buy dialog at all —
      // backend `provided_perps` is a static list per-provider, so the
      // UI is the only place that knows about ownership.
      if (Object.prototype.hasOwnProperty.call(groot.IPerps, p)) return;
      const type_data = (groot.getTypeData(p) || {}) as ProvidedPerpRow['data'];
      const perp: ProvidedPerpRow = {
        gestalt: p,
        data: type_data,
        locked: !buyable.has(p),
      };
      if (
        perp.locked &&
        perp.data.required_level &&
        !perp.data.required_providers &&
        perp.data.required_level <= groot.xp_level.number
      ) {
        perp.locked = false;
      }
      if (perp.locked && perp.data.required_providers && perp.data.required_providers.length) {
        perp.data.requiredProviders = [];
        perp.data.required_providers.forEach((v) => {
          const tdata = groot.getTypeData(v);
          if (tdata && typeof tdata.title === 'string') {
            perp.data.requiredProviders?.push(tdata.title);
          }
        });
      }
      dataRec.providedPerps?.push(perp);
    });
    // Sort by required_level then partition unlocked/locked.
    const sorted = (dataRec.providedPerps || []).slice().sort((a, b) => {
      const ra = a.data.required_level ?? 0;
      const rb = b.data.required_level ?? 0;
      return ra - rb;
    });
    const unlocked = sorted.filter((v) => !v.locked);
    const locked = sorted.filter((v) => v.locked);
    dataRec.providedPerps = unlocked.concat(locked);
  }
}

// Prototype-default shim — TS class field initializers (`sticky = true`,
// `cableType = 'in'`, `popupTemplate = 'popup.html'`) compile to
// constructor assignments under target ES2020.  The 10 perp subclasses
// in scripts/Game.js extend this class via the legacy `extend(SubClass,
// GamePerp)` helper from scripts/util.js, whose `function (config) {
// this.init(config); }` constructors never reach `super()` — so the
// field assignments never run and `instance.sticky` etc. resolve to
// `undefined`.  Restoring the defaults on the prototype reinstates the
// pre-#178 inherit-through-the-prototype-chain behaviour.  Retires when
// the legacy subclasses are migrated to proper TS classes (issue #187).
GamePerp.prototype.cableType = 'in';
GamePerp.prototype.sticky = true;
GamePerp.prototype.popupTemplate = 'popup.html';
