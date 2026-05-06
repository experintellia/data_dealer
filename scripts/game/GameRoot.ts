// GameRoot — the singleton at the top of every GameNode tree.  Owns:
//   - the `typeRegistry` (gestalt → game-type / type_data) populated
//     from server bootstrap data;
//   - DB-token state mirrors (`DBTokens`, `DBTokensAbsolute`,
//     `DBOriginTokens`, `IPerps`) that drive the income / charge
//     calculations on TokenPerp / ClientPerp / Database;
//   - the notification queue and a handful of lifecycle hooks (`kill`,
//     `lock`, `unlock`).
//
// Extracted from scripts/Game.js's IIFE in PR 19 of issue #147.  This
// PR moves the GameRoot **class shell** + the simplest method groups
// (type registry, DB tokens, lifecycle, parent-type lookups, the
// `getCityOriginAmounts` / `getDBFactorNormalized` / `updateGears` /
// `fetchProjectPowerupData` mixins).  The remaining ~38 methods
// (render hooks, status bar, level / XP, BuyPerp / BuyKarma,
// notifications, loadGame, view getters) stay as
// `GameRoot.prototype.X = function () {...}` assignments in Game.js
// for now; later PRs in the wave migrate them one batch at a time.

import appModule from '../app.js';
import setup from '../setup.js';
import { getTypeSettings } from '../type_settings.js';
import {
  GameNode,
  type GameNodeConfig,
  _ids,
  clear as clearRegistry,
  get,
  getByGestalt,
  getById,
  getByType,
} from './GameNode.js';
import { mergeData } from './mergeData.js';

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface TypeEntry {
  gestalt?: string;
  game_type?: string;
  type_data?: Record<string, unknown>;
  [key: string]: unknown;
}

interface OriginToken {
  gestalt: string | undefined;
  data: (Record<string, unknown> & { amount?: number; profiles_max?: number }) | undefined;
  amount: number | undefined;
  absoluteAmount: number | undefined;
  originGameNode: GameNode | undefined;
  originGameType: string | undefined;
  cityMaxAmount: number | undefined;
}

/** Minimal Render surface used by GameRoot's lifecycle, camera/zoom,
 *  and `setSize` methods.  Collapses when Render.js is typed (later
 *  in #147). */
interface RenderRootLike {
  lock?(): void;
  unlock?(): void;
  width?: number;
  height?: number;
  jdomelem?: {
    find?(sel: string): {
      off?(ev?: string): void;
      removeClass?(cls: string): void;
    };
    outerHeight?(): number;
  };
  setSize?(opts: { width?: number; height?: number }): void;
  render?(): void;
}

/** ViewMap render-node surface needed by `_centerActiveView` /
 *  `resetZoom` / `fitToWindow`.  Each ViewMap (Imperium, Database)
 *  owns a `scroller` and a `parentNode` (the viewport wrapper). */
interface ViewMapRenderLike extends RenderRootLike {
  scroller?: {
    scrollTo(x: number, y: number, animate?: boolean | unknown, zoom?: number): void;
  };
  updateScroller?(): void;
  parentNode?: { width?: number; height?: number };
  getPosition?(): { x: number; y: number };
}

/** A "View" GameNode (Imperium / Database) — owns a ViewMap-shaped
 *  render node.  Forward-ref shape; collapses when the View
 *  hierarchy is typed. */
interface ViewLike {
  renderNode?: ViewMapRenderLike;
}

/** Per-level config from `data.levels`.  AP regeneration interval +
 *  cap, XP range, and the level number (1-indexed). */
interface Level {
  number: number;
  xp_min: number;
  xp_max: number;
  ap_max: number;
  ap_inc_value: number;
  ap_inc_interval: number;
  [key: string]: unknown;
}

interface AniTickerLike {
  start(): void;
  stop(): void;
}

/** APTicker singleton interface — increments AP at level-derived
 *  intervals.  Game.js owns the implementation; injected via
 *  `setAPTickerForGameRoot`. */
interface APTickerLike {
  interval: number;
  reset(): void;
  start(offset?: number): void;
  addListener(node: GameNode): void;
}

/** Status-bar slot — one per game-value.  `val`/`max` drive the
 *  numeric label; `barsize` drives the pixel width of the visual
 *  bar (clipped to design-time max widths). */
interface StatusBarSlot {
  val?: number;
  max?: number;
  barsize?: number;
  level?: number;
  crosssum?: number;
  tokenslength?: number;
  tokenslengthmax?: number;
}

interface StatusBarData extends Record<string, unknown> {
  gameNode?: GameNode;
  AP: StatusBarSlot;
  cash: StatusBarSlot;
  profiles: StatusBarSlot;
  karma: StatusBarSlot;
  XP: StatusBarSlot;
}

/** Statusbar render-node surface for the FXUpdate* fan-out. */
interface RenderStatusbarLike extends RenderRootLike {
  FXUpdateAP?(silent?: boolean): void;
  FXUpdateCash?(silent?: boolean): void;
  FXUpdateProfiles?(silent?: boolean): void;
  FXUpdateKarma?(silent?: boolean): void;
  FXUpdateXP?(silent?: boolean): void;
}

/** Server-side game_values payload — every field is independently
 *  optional (the engine emits partial deltas). */
interface GameValuesPayload {
  ap_initial?: number;
  ap_offset?: number;
  ap_increment?: number;
  ap_snapshot?: number;
  profiles_value?: number;
  profiles_max?: number;
  cash_value?: number;
  cash_max?: number;
  karma_value?: number;
  xp_value?: number;
  xp_level?: number;
  [key: string]: unknown;
}

/** Missions singleton API used by `updateGameValues` (the only
 *  caller).  Forward-ref; collapses when Missions itself extracts. */
interface MissionsLike {
  updateMissions(missions: unknown, gv: GameValuesPayload): void;
}

let _aniTicker: AniTickerLike | null = null;
/** Game.js injects the AniTicker singleton at IIFE-end via this setter
 *  (parallel to `setAniTicker` on GamePerp).  Disposable seam — retires
 *  when AniTicker itself extracts. */
export function setAniTickerForGameRoot(ticker: AniTickerLike): void {
  _aniTicker = ticker;
}

let _apTicker: APTickerLike | null = null;
/** Game.js injects the APTicker singleton at IIFE-end (parallel to
 *  `setAniTickerForGameRoot`).  Used by `setLevel` / `APTick`.
 *  Disposable seam — retires when APTicker itself extracts. */
export function setAPTickerForGameRoot(ticker: APTickerLike): void {
  _apTicker = ticker;
}

// ---------------------------------------------------------------------------
// GameRoot class
// ---------------------------------------------------------------------------

export class GameRoot extends GameNode {
  override renderType = 'Stage';

  typeRegistry: Record<string, TypeEntry> = {};
  DBTokens: Record<string, number> = {};
  DBTokensAbsolute: Record<string, number> = {};
  DBOriginTokens: Record<string, OriginToken> = {};
  DBTokensCrossSum = 0;
  DBTokensLength = 0;
  DBTokensLengthMax = 0;
  IPerps: Record<string, true> = {};
  NotificationQueue: unknown[] = [];

  // Field assignments preserved from the legacy `GameRoot.prototype.X
  // = ...` block — exposed for callers that read `groot.get` / `groot.
  // ids` / `groot.setup` / `groot.getById` (the legacy IIFE made them
  // explicit prototype slots; preserved as instance-bound aliases here
  // so existing call sites keep working).
  get = get;
  ids = _ids;
  setup = setup;
  getById = getById;

  // notification_level controls verbosity in makeNotifications (still
  // in Game.js).  Class-field default matches the legacy prototype.
  notification_level = 2;

  // Properties stamped onto GameRoot during gameplay or via the
  // not-yet-migrated methods that still live in Game.js.  Declared
  // here so subclass call sites that read them through the typed
  // GameRoot reference don't need per-call casts.
  profiles_value = 0;
  profiles_max = 0;
  cash_value = 0;
  cash_max = 0;
  ap_value = 0;
  ap_offset = 0;
  karma_value = 0;
  karma_max = 100;
  xp_value = 0;
  xp_level: Level = {
    number: 0,
    xp_min: 0,
    xp_max: 0,
    ap_max: 0,
    ap_inc_value: 0,
    ap_inc_interval: 0,
  };
  /** Set by `loadGame` (still in Game.js) once the Missions singleton
   *  is constructed.  Forward-ref optional until Missions extracts. */
  Missions?: MissionsLike;
  data: {
    status_icons?: unknown;
    status_bar?: StatusBarData;
    width?: number;
    height?: number;
    levels?: Level[];
    game_values?: GameValuesPayload;
    [key: string]: unknown;
  } = {};
  override renderNode?: NonNullable<GameNode['renderNode']> & RenderRootLike;
  // `renderMenu` widens GameNode's typed declaration to also expose the
  // RenderRoot lock/unlock surface the lifecycle methods touch.
  override renderMenu?: NonNullable<GameNode['renderMenu']> &
    RenderRootLike & {
      addButton?(label: string, id: string, states: unknown): void;
    };
  override renderStatusbar?: NonNullable<GameNode['renderStatusbar']> & RenderStatusbarLike;
  /** Active ViewMap (Imperium or Database).  Set by switch_view; read
   *  by the camera/zoom helpers and by `fitToWindow` / `setSize`. */
  activeView?: ViewLike;
  /** Debounce handle for `_centerActiveView` (50ms).  `_cancelPending-
   *  Center` clears it so explicit camera moves aren't clobbered. */
  _centerActiveViewTimer?: ReturnType<typeof setTimeout> | null;

  // View-getter mixins still live in Game.js (migrate in a follow-up
  // PR).  Declared as optional methods so the camera/zoom helpers can
  // call them through the typed GameRoot reference.
  getImperium?(): ViewLike | undefined;
  getDatabase?(): GameNode & {
    renderDBQueue?: { render?(): void };
    checkNotifications?(): void;
  };

  // Notification mixins still live in Game.js (migrate in a follow-up
  // PR).  Declared optional so `updateGameValues` can dispatch through
  // the typed reference.
  makeNotifications?(data: Record<string, unknown>): void;

  notificationPopup?: NonNullable<GameNode['renderPopup']> & {
    render?(): void;
    notificationMission?: string | null;
  };
  retryDelay?: number;

  // -------------------------------------------------------------------
  // Type registry
  // -------------------------------------------------------------------

  addType(gestalt: string, data: TypeEntry): TypeEntry {
    // Add a type to the typeRegistry. `data` should have data.type_data.
    // If the game_type is also defined in typeSettings, the legacy
    // typeSettings entry's type_data is merged into the inbound data
    // (inbound wins on conflict).
    if (data.game_type && data.type_data) {
      const ts = getTypeSettings() as Record<string, TypeEntry>;
      if (Object.prototype.hasOwnProperty.call(ts, data.game_type)) {
        const baseTd = ts[data.game_type]?.type_data;
        if (baseTd) {
          data.type_data = mergeData(baseTd, data.type_data) as Record<string, unknown>;
        }
      }
    }
    this.typeRegistry[gestalt] = data;
    data.gestalt = gestalt;
    // FIXME: is_supertoken fix for export fail.
    if (gestalt.substring(0, 5) === 'token' && data.type_data) {
      data.type_data.is_supertoken = false;
    }
    return data;
  }

  addSubType(parent_gestalt: string, gestalt: string, data: TypeEntry): TypeEntry | undefined {
    const parentType = this.getType(parent_gestalt) as
      | (TypeEntry & Record<string, TypeEntry>)
      | undefined;
    if (!parentType) return undefined;
    if (data.game_type && data.type_data) {
      const ts = getTypeSettings() as Record<string, TypeEntry>;
      if (Object.prototype.hasOwnProperty.call(ts, data.game_type)) {
        const baseTd = ts[data.game_type]?.type_data;
        if (baseTd) {
          data.type_data = mergeData(baseTd, data.type_data) as Record<string, unknown>;
        }
        // expand powerup tokens with their type data
        const td = data.type_data as { tokens?: Array<{ gestalt?: string; type_data?: unknown }> };
        if (td.tokens?.length) {
          td.tokens.forEach((v) => {
            if (v.gestalt) v.type_data = this.getTypeData(v.gestalt);
          });
        }
      }
      parentType[gestalt] = data;
      return data;
    }
    return undefined;
  }

  removeType(gestalt: string): void {
    delete this.typeRegistry[gestalt];
  }

  override getType(gestalt?: string): TypeEntry | undefined {
    if (gestalt === undefined) return undefined;
    return this.typeRegistry[gestalt];
  }

  getTypeData(gestalt?: string): Record<string, unknown> | undefined {
    return this.getType(gestalt)?.type_data;
  }

  getTypes(game_type: string): TypeEntry[] {
    return Object.values(this.typeRegistry).filter((t) => t.game_type === game_type);
  }

  /** Returns `''` when called with a falsy gestalt — legacy returned
   *  `{}` here, but every caller treats the result as a string game-
   *  type name.  The `{}` was a mis-typed sentinel; flatten to `''` so
   *  the strict TS signature stays clean.  Audited 2026-05-06: both
   *  call sites (Game.js:866 GameRoot.BuyPerp and GameNode.ts:757
   *  initPopupEvents PerpBuyButton handler) compare the result with
   *  `=== 'CityPerp'` — the legacy `{}` would have failed that check
   *  identically to `''`.  No truthy-empty-object dependency exists. */
  getTypeFromGestalt(gestalt?: string): string {
    if (!gestalt) return '';
    return this.typeRegistry[gestalt]?.game_type ?? '';
  }

  /** Predicate shared by `getParentType` / `getParentTypeData` /
   *  `getParentTypes`: a typeRegistry entry whose `provided_perps` list
   *  contains `gestalt`. */
  private _providesGestalt(t: TypeEntry, gestalt: string): boolean {
    const provided = (t.type_data as { provided_perps?: string[] } | undefined)?.provided_perps;
    return !!provided?.includes(gestalt);
  }

  getParentTypes(gestalt: string): TypeEntry[] {
    return Object.values(this.typeRegistry).filter((t) => this._providesGestalt(t, gestalt));
  }

  getParentTypeData(gestalt: string): Record<string, unknown> {
    return (
      Object.values(this.typeRegistry).find((t) => this._providesGestalt(t, gestalt))?.type_data ??
      {}
    );
  }

  getParentType(gestalt: string): TypeEntry {
    return Object.values(this.typeRegistry).find((t) => this._providesGestalt(t, gestalt)) ?? {};
  }

  // -------------------------------------------------------------------
  // DB-token state
  // -------------------------------------------------------------------

  getDBTokenAmount(gestalt: string): number {
    return Object.prototype.hasOwnProperty.call(this.DBTokens, gestalt)
      ? (this.DBTokens[gestalt] ?? 0)
      : 0;
  }

  /** Length without origin tokens.  Mutates the cached
   *  `DBTokensLength` field as a side effect (legacy behaviour
   *  preserved — callers read both the return value and the field). */
  getDBTokensLength(): number {
    const len = Object.keys(this.DBTokens).filter((t) => t.substring(0, 6) !== 'origin').length;
    this.DBTokensLength = len;
    return len;
  }

  /** Max length without origin tokens.  Mutates the cached
   *  `DBTokensLengthMax` field. */
  getDBTokensLengthMax(): number {
    const len = Object.values(this.typeRegistry).filter(
      (t) => t.game_type === 'TokenPerp' && (t.gestalt ?? '').substring(0, 6) !== 'origin'
    ).length;
    this.DBTokensLengthMax = len;
    return len;
  }

  /** Cross-sum: arithmetic mean of `DBTokens` values, with `count`
   *  initialized at 1 (matches the legacy `count = 1` quirk; not the
   *  textbook average).  `gestalt` is unused — preserved as a parameter
   *  for callsite compat. */
  getDBTokensCrossSum(_gestalt?: string): number {
    const values = Object.values(this.DBTokens);
    const sum = values.reduce((memo, v) => memo + (v ?? 0), 0);
    return sum / (values.length + 1);
  }

  compileOriginTokens(
    nodes: Array<{ gestalt?: string; instance_data?: { amount?: number } }>
  ): void {
    const origintokens = nodes.filter((n) => n.gestalt?.substring(0, 6) === 'origin');
    origintokens.forEach((t) => {
      if (!t.gestalt) return;
      const td = this.getTypeData(t.gestalt) as
        | { amount?: number; origin_gestalt?: string; profiles_max?: number; [k: string]: unknown }
        | undefined;
      const amount = t.instance_data?.amount ?? 0;
      if (td) td.amount = amount;
      const originGestalt = td?.origin_gestalt;
      const originNode = originGestalt ? getByGestalt(originGestalt) : undefined;
      const originGameType = originNode?.gameType;
      let cityMaxAmount: number | undefined;
      if (originGameType === 'CityPerp') {
        const citymax = (originNode?.data as { profiles_max?: number } | undefined)?.profiles_max;
        if (citymax) {
          cityMaxAmount = ((amount / 100) * this.profiles_value) / citymax;
        }
      }
      this.DBOriginTokens[t.gestalt] = {
        gestalt: t.gestalt,
        data: td,
        amount,
        absoluteAmount: (this.profiles_value * amount) / 100,
        originGameNode: originNode,
        originGameType,
        cityMaxAmount,
      };
    });
  }

  /** Hardcoded `'city002'` lookup is preserved from legacy.  Suspected
   *  copy-paste latent bug — should probably read `origintokengestalt`'s
   *  origin link.  Tracked in issue #203. */
  getOriginGestaltFromOriginTokenGestalt(_origintokengestalt: string): string | undefined {
    const origin = Object.values(this.DBOriginTokens).find(
      (ot) => ot.originGameNode?.gestalt === 'city002'
    );
    return origin?.gestalt;
  }

  getCityOriginAmounts(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const ot of Object.values(this.DBOriginTokens)) {
      if (ot.originGameType === 'CityPerp' && ot.gestalt && ot.cityMaxAmount !== undefined) {
        out[ot.gestalt] = ot.cityMaxAmount;
      }
    }
    return out;
  }

  getDBFactorNormalized(): number {
    const cityamounts = this.getCityOriginAmounts();
    return Object.values(cityamounts).reduce((memo, num) => memo + num, 0);
  }

  updateGears(): void {
    getByType('TokenPerp').forEach((t) => {
      (t as GameNode & { updateGear?(): void }).updateGear?.();
    });
  }

  // -------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------

  kill(): void {
    console.warn('Killing Game');
    // `clear()` lives in GameNode.ts; legacy bound it as a free import.
    // Imported at the top of this file via the registry helpers.
    clearRegistry();
    const app = appModule.getApplication() as { game?: unknown };
    delete app.game;
  }

  lock(): void {
    // Lock the whole stage and turn off triggering of render Events.
    // TODO: make stage spinner in Render and use proper method to
    // unbind events.  Unlock currently wouldn't work since all events
    // are destroyed (FIXME for popups).
    if (this.renderNode) {
      this.renderNode.lock?.();
      this.renderMenu?.lock?.();
      _aniTicker?.stop();
    }
  }

  unlock(): void {
    if (this.NotificationQueue && this.NotificationQueue.length < 2) {
      this.renderNode?.unlock?.();
      this.renderMenu?.unlock?.();
      _aniTicker?.start();
    } else if (!this.NotificationQueue) {
      this.renderNode?.unlock?.();
      this.renderMenu?.unlock?.();
      _aniTicker?.start();
    }
  }

  // -------------------------------------------------------------------
  // Camera / zoom (extracted in PR 20 of issue #147)
  // -------------------------------------------------------------------

  /** The active ViewMap for camera math — `activeView` if set,
   *  otherwise Imperium.  `getImperium` lives on the not-yet-extracted
   *  Game.js side; the optional-chain handles the load-order window
   *  before `loadGame` runs.  Returns `undefined` when no view is
   *  available. */
  private _resolveActiveViewMap(): ViewMapRenderLike | undefined {
    const view = this.activeView ?? this.getImperium?.();
    return view?.renderNode;
  }

  /** Cancel any debounced `_centerActiveView` so an explicit camera
   *  move (reset-zoom, tutorial scrollTo) isn't clobbered ~50ms
   *  later. */
  _cancelPendingCenter(): void {
    if (this._centerActiveViewTimer) clearTimeout(this._centerActiveViewTimer);
    this._centerActiveViewTimer = null;
  }

  /** The fullscreen button resets zoom AND re-centers on the ViewMap's
   *  design home point — for Imperium that's where the seed places
   *  the Database (≈1024,800).  No-op if no ViewMap is active. */
  resetZoom(): void {
    const vm = this._resolveActiveViewMap();
    if (!vm?.scroller || typeof vm.scroller.scrollTo !== 'function') return;
    vm.updateScroller?.();
    const vp = vm.parentNode;
    if (!vp) return;
    this._cancelPendingCenter();
    // Combined zoom+scroll in one __publish so the tween goes
    // (current zoom, current scroll) → (1.0, centered) instead of
    // two animations fighting each other.
    const sx = Math.max(0, (vm.width ?? 0) / 2 - (vp.width ?? 0) / 2);
    const sy = Math.max(0, (vm.height ?? 0) / 2 - (vp.height ?? 0) / 2);
    vm.scroller.scrollTo(sx, sy, true, 1);
  }

  /** Re-centers the active ViewMap on its design home point.
   *  Debounced so rapid callers during initial mount (`fitToWindow`
   *  → `after_render` → tutorial `switch_view`) collapse into one
   *  scroll. */
  _centerActiveView(animate: boolean): void {
    this._cancelPendingCenter();
    this._centerActiveViewTimer = setTimeout(() => {
      this._centerActiveViewTimer = null;
      // Inlined resolution (rather than `_resolveActiveViewMap()`)
      // because the Imperium home-point branch below needs the
      // `view` reference for `view === this.getImperium()` identity.
      const view = this.activeView ?? this.getImperium?.();
      const vm = view?.renderNode;
      if (!vm?.scroller || !vm.parentNode) return;
      const vw = vm.parentNode.width ?? 0;
      const vh = vm.parentNode.height ?? 0;
      const maxX = Math.max(0, (vm.width ?? 0) - vw);
      const maxY = Math.max(0, (vm.height ?? 0) - vh);

      // Imperium centres on the DatabasePerp (visual focal point);
      // its rendered position is offset from vm.width/2 once the
      // type_data anchor is applied, enough to be visibly off-centre
      // on a phone viewport.  Other views fall back to geometric
      // centre.
      let homeX = (vm.width ?? 0) / 2;
      let homeY = (vm.height ?? 0) / 2;
      if (this.getImperium && view === this.getImperium()) {
        const db = getByType('DatabasePerp')[0];
        const dbPos = (db?.renderNode as ViewMapRenderLike | undefined)?.getPosition?.();
        if (dbPos) {
          homeX = dbPos.x;
          homeY = dbPos.y;
        }
      }

      const sx = Math.max(0, Math.min(maxX, homeX - vw / 2));
      const sy = Math.max(0, Math.min(maxY, homeY - vh / 2));
      vm.scroller.scrollTo(sx, sy, animate);
    }, 50);
  }

  /** Size the renderable area to the current viewport.  Called on
   *  initial load and on window resize so the game fills the available
   *  space by default rather than sitting in a 960×600 letterbox. */
  fitToWindow(): void {
    // The MainMenu is a sibling of the Stage in #GameContainer (not
    // a child), so its height eats into the available viewport —
    // without subtracting it the Stage pushes the page past the
    // bottom edge.
    const menuH = this.renderMenu?.jdomelem?.outerHeight?.() ?? 0;
    const $ = globalThis.$;
    if (!$) return;
    const win = $(window);
    this.setSize(
      (win as unknown as { width(): number }).width(),
      (win as unknown as { height(): number }).height() - menuH
    );
    // Refresh the scroller's viewport dimensions so the new stage
    // size is reflected in clamping/zoom math.  Without this,
    // scrollTo and the +/- zoom buttons clamp against the previous
    // viewport.
    const vm = this._resolveActiveViewMap();
    vm?.updateScroller?.();
    this._centerActiveView(false);
  }

  setSize(width: number, height: number): void {
    const rn = this.renderNode;
    if (!rn) return;
    const imperium = this.getImperium?.();
    const imperiumRn = imperium?.renderNode as ViewMapRenderLike | undefined;
    const maxwidth = imperiumRn?.width ?? width;
    const maxheight = imperiumRn?.height ?? height;
    const minwidth = this.data.width ?? 0;
    const minheight = this.data.height ?? 0;

    let w = width || rn.width || 0;
    let h = height || rn.height || 0;
    w = Math.min(maxwidth, Math.max(minwidth, w));
    h = Math.min(maxheight, Math.max(minheight, h));

    rn.setSize?.({ width: w, height: h });
    this.renderMenu?.setSize?.({ width: w });
    this.renderStatusbar?.render?.();
    const dbQueue = (this.getDatabase?.() as { renderDBQueue?: { render?(): void } } | undefined)
      ?.renderDBQueue;
    dbQueue?.render?.();
  }

  // -------------------------------------------------------------------
  // Status bar / level / XP (extracted in PR 21 of issue #147)
  // -------------------------------------------------------------------

  initStatusBar(): void {
    if (this.data.status_bar) this.data.status_bar.gameNode = this;
    this.updateStatusBarValues();
  }

  setLevel(levelnum?: number, nolevelup?: boolean): Level {
    const lvl = levelnum ? this.getLevel(levelnum) : this.getLevel();
    if (lvl !== this.getLevelByXP(this.xp_value)) {
      this.xp_value = lvl.xp_min;
    }
    this.xp_level = lvl;
    if (_apTicker) {
      _apTicker.interval = lvl.ap_inc_interval;
      if (!nolevelup) _apTicker.reset();
    }
    this.setAP();
    this.setXP();
    return this.xp_level;
  }

  /** Looks up `data.levels[level - 1]` (legacy 1-indexed); falls back
   *  to the current `data.game_values.xp_level`.  The zero-Level
   *  fallback covers two cases:
   *    - `data.levels` unset (server bootstrap not yet run);
   *    - `level` index out of bounds.
   *  Both are dead paths in production (loadGame populates `levels`
   *  before any `setLevel` caller runs), but the strict-TS shape
   *  silently no-ops rather than throwing the legacy `TypeError` on
   *  `undefined.xp_min`. */
  getLevel(level?: number): Level {
    const levels = this.data.levels ?? [];
    const idx = level ? level - 1 : (this.data.game_values?.xp_level ?? 1) - 1;
    return (
      levels[idx] ?? {
        number: 0,
        xp_min: 0,
        xp_max: 0,
        ap_max: 0,
        ap_inc_value: 0,
        ap_inc_interval: 0,
      }
    );
  }

  /** Returns the Level whose `xp_min..xp_max` window contains `xp`,
   *  or an empty Level-shape when `xp` is falsy.  Legacy returned
   *  `{}` for the falsy branch — flattened to a Level-shaped sentinel
   *  to keep the strict-TS signature clean (callers pass it to
   *  `setLevel`'s identity check, never read fields off it). */
  getLevelByXP(xp?: number): Level {
    if (!xp) {
      return { number: 0, xp_min: 0, xp_max: 0, ap_max: 0, ap_inc_value: 0, ap_inc_interval: 0 };
    }
    const found = (this.data.levels ?? []).find((lvl) => xp >= lvl.xp_min && xp <= lvl.xp_max);
    return (
      found ?? { number: 0, xp_min: 0, xp_max: 0, ap_max: 0, ap_inc_value: 0, ap_inc_interval: 0 }
    );
  }

  override APTick(): void {
    if (this.xp_level.ap_max > this.ap_value) {
      this.ap_value += this.xp_level.ap_inc_value;
      this.setAP();
      // Remove No-AP decorators
      const popups = this.renderNode?.jdomelem?.find?.('.Popup .no_AP');
      popups?.removeClass?.('no_AP disabled active');
    }
  }

  /** Map (and eventually crunch) game_values onto status-bar values
   *  without rendering — the per-setter methods own the render
   *  trigger.  All five setters still live in Game.js (next PR). */
  updateStatusBarValues(): void {
    this.setProfiles();
    this.setCash();
    this.setAP();
    this.setKarma();
    this.setXP();
  }

  // -------------------------------------------------------------------
  // Game values (extracted in PR 22 of issue #147)
  // -------------------------------------------------------------------

  /** Hydrates the GameRoot's value-state from the bootstrap
   *  `data.game_values` payload, anchors the first level, and starts
   *  APTicker.  Called once per game-load by `loadGame` (still in
   *  Game.js). */
  initGameValues(): void {
    const gv = this.data.game_values ?? {};
    this.ap_value = gv.ap_initial ?? 0;
    this.ap_offset = gv.ap_offset ?? 0;
    this.profiles_value = gv.profiles_value ?? 0;
    this.profiles_max = gv.profiles_max ?? 0;
    this.cash_value = gv.cash_value ?? 0;
    // cash_max was never initialised in the legacy code, so the
    // cash-bar barsize divided by undefined → NaN.  Pin to a sane
    // large default so the bar fills meaningfully without overflowing
    // once the player accumulates cash from client collections.  Use
    // `||` (not `??`) to match legacy behaviour: `cash_max === 0`
    // also falls through to the default, since 0 would NaN-cascade
    // through the barsize division.
    this.cash_max = gv.cash_max || 10000;
    this.karma_value = gv.karma_value ?? 0;
    this.karma_max = 100;
    this.xp_value = gv.xp_value ?? 0;
    this.setLevel(gv.xp_level, true);
    if (_apTicker) {
      _apTicker.addListener(this);
      _apTicker.start(this.ap_offset);
    }
  }

  updateGameValues(
    game_values: GameValuesPayload,
    levelup?: boolean,
    missions?: unknown,
    silent?: boolean
  ): void {
    const gv = game_values;
    if (missions) {
      this.Missions?.updateMissions(missions, game_values);
      // FIXME: TESTING when mission completed, do not yet update
      // game_values
    }
    if (gv.profiles_max !== undefined) {
      this.profiles_max = gv.profiles_max;
    }
    if (gv.profiles_value !== undefined && gv.profiles_value !== this.profiles_value) {
      this.setProfiles(gv.profiles_value, silent);
    }
    if (gv.cash_value !== undefined && gv.cash_value !== this.cash_value) {
      this.setCash(gv.cash_value, silent);
    }
    if (gv.ap_increment) {
      this.useAP(gv.ap_increment);
    }
    if (gv.karma_value !== undefined && gv.karma_value !== this.karma_value) {
      this.setKarma(gv.karma_value, silent);
    }
    if (gv.xp_value !== undefined) {
      this.setXP(gv.xp_value, silent);
    }
    // ap_snapshot is the authoritative engine AP — sync the visible
    // ap_value whenever it differs, not only on levelup.  Without this,
    // the statusbar AP bar shows stale text after every chargePerp /
    // integrateCollected (handlers decrement ap_snapshot but Game.js
    // never reapplied it pre-#120 follow-up).
    if (gv.ap_snapshot !== undefined && gv.ap_snapshot !== this.ap_value) {
      this.setAP(gv.ap_snapshot, silent);
    }
    // levelup-only side effects.
    if (gv.ap_snapshot !== undefined && levelup === true && !silent) {
      this.getDatabase?.().checkNotifications?.();
      this.makeNotifications?.({ levelup: this.xp_level.number });
    }
  }

  /** Additive AP delta wrapper.  Note: legacy `updateGameValues`
   *  passed a `silent` arg here that was silently dropped (the
   *  legacy signature accepted one param).  Preserved as-is to keep
   *  this PR a pure migration; the latent flicker bug is tracked in
   *  issue #207. */
  useAP(inc: number): void {
    this.setAP(this.ap_value + inc);
  }

  setAP(num?: number, silent?: boolean): void {
    if (num !== undefined) this.ap_value = num;
    if (this.ap_value > this.xp_level.ap_max) {
      this.ap_value = this.xp_level.ap_max;
    }
    const sb = this.data.status_bar;
    if (!sb) return;
    // Only clip AP display: internally it can be -1 since that's the
    // server's bonus.
    const clipped = this.ap_value < 0 ? 0 : this.ap_value;
    sb.AP.val = clipped;
    sb.AP.max = this.xp_level.ap_max;
    sb.AP.barsize = Math.min(120, Math.max(0, Math.round((clipped / this.xp_level.ap_max) * 120)));
    // Always invoke FXUpdate*: the Statusbar template binds the flat
    // AP_val prop, which only refreshes inside FXUpdateAP.  Skipping
    // it on silent paths leaves the rendered DOM stale (issue #153).
    this.renderStatusbar?.FXUpdateAP?.(silent);
  }

  setCash(num?: number, silent?: boolean): void {
    if (num !== undefined) this.cash_value = num;
    const sb = this.data.status_bar;
    if (!sb) return;
    sb.cash.val = this.cash_value;
    sb.cash.barsize = Math.min(
      120,
      Math.max(0, Math.round((this.cash_value / this.cash_max) * 120))
    );
    this.renderStatusbar?.FXUpdateCash?.(silent);
  }

  setProfiles(num?: number, silent?: boolean): void {
    if (num !== undefined) this.profiles_value = num;
    if (this.profiles_value > this.profiles_max) {
      this.profiles_value = this.profiles_max;
    }
    const sb = this.data.status_bar;
    if (!sb) return;
    sb.profiles.val = this.profiles_value;
    sb.profiles.max = this.profiles_max;
    sb.profiles.barsize = Math.min(
      120,
      Math.max(0, Math.round((this.profiles_value / this.profiles_max) * 120))
    );
    sb.profiles.crosssum = this.getDBTokensCrossSum();
    this.getDBTokensLength();
    sb.profiles.tokenslength = this.DBTokensLength;
    sb.profiles.tokenslengthmax = this.DBTokensLengthMax;
    this.renderStatusbar?.FXUpdateProfiles?.(silent);
  }

  setKarma(num?: number, silent?: boolean): void {
    if (num !== undefined) this.karma_value = num;
    if (this.karma_value > this.karma_max) {
      this.karma_value = this.karma_max;
    }
    if (this.karma_value < -this.karma_max) {
      this.karma_value = -this.karma_max;
    }
    const sb = this.data.status_bar;
    if (!sb) return;
    sb.karma.val = this.karma_value;
    sb.karma.max = this.karma_max || 100;
    // FIXME: set to correct level not 50.
    sb.karma.barsize = Math.min(
      59,
      Math.max(-59, Math.round((this.karma_value / this.karma_max) * 59))
    );
    this.renderStatusbar?.FXUpdateKarma?.(silent);
  }

  setXP(num?: number, silent?: boolean): void {
    if (num !== undefined && num > this.xp_value) {
      this.xp_value = num;
    }
    if (this.xp_value > this.xp_level.xp_max) {
      this.setLevel(this.getLevelByXP(this.xp_value).number);
    }
    if (this.xp_value < this.xp_level.xp_min) {
      this.setLevel(this.getLevelByXP(this.xp_value).number);
    }
    const sb = this.data.status_bar;
    if (!sb) return;
    sb.XP.val = this.xp_value;
    sb.XP.level = this.xp_level.number;
    const span = this.xp_level.xp_max - this.xp_level.xp_min;
    sb.XP.barsize = Math.min(
      96,
      Math.max(0, Math.round(((this.xp_value - this.xp_level.xp_min) / span) * 96))
    );
    this.renderStatusbar?.FXUpdateXP?.(silent);
  }

  // -------------------------------------------------------------------
  // ProjectPerp powerup fetch (used by ProjectPerp.fetchPowerups)
  // -------------------------------------------------------------------

  /** Register every entry in `data.result` as a subtype under
   *  `project_gestalt`.  Shared by the two `getPowerups` `.done`
   *  branches in `fetchProjectPowerupData`. */
  private _registerPowerups(
    data: { result?: Record<string, TypeEntry> },
    project_gestalt: string
  ): void {
    Object.values(data.result ?? {}).forEach((v) => {
      const sub = v.game_gestalt as string | undefined;
      if (sub) this.addSubType(project_gestalt, sub, v);
    });
  }

  fetchProjectPowerupData(project_gestalt: string, cb?: () => void): void {
    const gnode = getByGestalt(project_gestalt);
    const remote = appModule.getApplication().remote as {
      getPowerups?(
        gestalt: string,
        version: unknown
      ): {
        done(cb: (data: { result?: Record<string, TypeEntry> }) => void): unknown;
      };
    };
    const fn = remote.getPowerups;
    if (!fn) {
      cb?.();
      return;
    }
    const app = appModule.getApplication() as { version?: unknown };
    const dataNode = gnode?.data as { powerupsCached?: boolean; [k: string]: unknown } | undefined;
    const popup = gnode?.renderPopup as { templateData?: { cached?: boolean } } | undefined;

    if (gnode && !dataNode?.powerupsCached) {
      fn(project_gestalt, app.version).done((data) => {
        this._registerPowerups(data, project_gestalt);
        if (popup?.templateData) popup.templateData.cached = true;
        if (dataNode) dataNode.powerupsCached = true;
        cb?.();
      });
    } else if (gnode && popup?.templateData) {
      popup.templateData.cached = true;
      cb?.();
    } else {
      fn(project_gestalt, app.version).done((data) => {
        this._registerPowerups(data, project_gestalt);
        cb?.();
      });
    }
  }
}
