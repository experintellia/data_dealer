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

import type { ComponentType } from 'preact';
import { type RenderApi, getRender } from '../Render.js';
import appModule from '../app.js';
import { APStatusPopup } from '../components/popups/APStatusPopup.js';
import { AboutPopup, type ImportOutcome } from '../components/popups/AboutPopup.js';
import { CashStatusPopup } from '../components/popups/CashStatusPopup.js';
import { ProfilesStatusPopup } from '../components/popups/ProfilesStatusPopup.js';
import { ProvidedPerpPopup } from '../components/popups/ProvidedPerpPopup.js';
import { XPStatusPopup } from '../components/popups/XPStatusPopup.js';
import { type PreactDialogHandle, openDialog } from '../components/popups/dialogManager.js';
import { type DialogSpec, resolveDialog } from '../components/popups/dialogRegistry.js';
import { debounce, span, sprintf, toKSNum } from '../dd-helpers.js';
import i18n from '../i18n.js';
import type { SpriteHelperConfig } from '../render/renderSpriteHelper.js';
import setup from '../setup.js';
import { getTypeSettings } from '../type_settings.js';
import webxdcIdentity from '../webxdc-identity.js';
import { Database } from './Database.js';
import {
  GameNode,
  type GameNodeConfig,
  _ids,
  clear as clearRegistry,
  eachByGestalt,
  get,
  getAllByGestalt,
  getByFirstId,
  getByGestalt,
  getById,
  getByLastId,
  getByType,
  getFirstId,
  getGestalt,
  getParentFromPath,
} from './GameNode.js';
import type { RenderPopupLike } from './GamePerp.js';
import { Imperium } from './Imperium.js';
import { Mission } from './Mission.js';
import { Missions } from './Missions.js';
import { Topscore } from './Topscore.js';
import { Topscores } from './Topscores.js';
import { buildKarmaPopupVM } from './karmaView.js';
import { mergeData } from './mergeData.js';
import { buildMissionPopupProps } from './missionView.js';
import { perpCtors } from './perpCtors.js';
import { buildProvidedContext } from './providedView.js';

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
      addClass?(cls: string): void;
      removeClass?(cls: string): void;
    };
    outerHeight?(): number;
  };
  setSize?(opts: { width?: number; height?: number }): void;
  render?(): void;
  addPopup?(popup: unknown): void;
  /** Owned by RenderMainMenu (RenderViews.ts).  Cloned-XP-bar slot
   *  refresh; `sb` is structurally a RenderStatusbar (XP_* scalars). */
  renderXP?(sb: unknown): void;
  // FX hooks driven by makeNotifications.  All optional; the Stage
  // owns the implementations (Render.js).
  FXMissionComplete?(): void;
  FXMissionGoalComplete?(): void;
  FXLevelUpBling?(level: number | true): void;
  FXKarmaBling?(amount: number): void;
  FXNoCash?(): void;
  FXError?(): void;
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
  /** Current zoom scale applied to the ViewMap content.  Default
   *  Imperium is 0.75; needed by `_centerActiveView` so the scroll
   *  bounds and home-point math are in the same scaled-content
   *  space as `scroller.scrollTo`. */
  zoomScale?: number;
  /** Direct-on-renderNode `scrollTo(pos, durationMs)` — distinct from
   *  `scroller.scrollTo(x, y, animate, zoom)` above; used by tutorial
   *  scripted-events in `makeNotifications`. */
  scrollTo?(pos: { x: number; y: number }, durationMs?: number): void;
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

/** Level-shaped zero sentinel.  Used where a real level isn't available
 *  yet (pre-bootstrap `xp_level`, out-of-range `getLevel`/`getLevelByXP`
 *  lookups) so the strict-TS shape stays satisfied without a legacy
 *  `undefined.xp_min` TypeError.  Returns a fresh object each call —
 *  callers assign it to `xp_level`, which other code may overwrite. */
function emptyLevel(): Level {
  return { number: 0, xp_min: 0, xp_max: 0, ap_max: 0, ap_inc_value: 0, ap_inc_interval: 0 };
}

// Render Popup surface used by `openNotification` — re-imports the
// canonical `RenderPopupLike` from GamePerp.ts (was duplicated across
// GameRoot / GameNode / GamePerp / Database / ProjectPerp before this
// PR).

/** Render MainMenu instance — created in `extendRender`. */
interface MainMenuLike extends RenderRootLike {
  data?: { buttons?: Array<{ id: string }>; [key: string]: unknown };
  domelem?: unknown;
  initUI?(): void;
  remove(): void;
}

/** Server-side bootstrap payload to `loadGame`.  Loose-shape — every
 *  field is independently optional and the engine populates each
 *  conditionally. */
interface LoadGameData {
  _id?: string;
  user?: unknown;
  type_registry?: Record<string, TypeEntry>;
  type_data?: Record<string, unknown>;
  nodes?: ServerNode[];
  nodes_charging?: Array<{ path: string; charge_start: number }>;
  nodes_collect?: Array<{ path: string }>;
  Imperium?: {
    game_id?: string;
    full_path?: string;
    type_data?: Record<string, unknown>;
    instance_data?: Record<string, unknown>;
  };
  Database?: {
    game_id?: string;
    full_path?: string;
    type_data?: Record<string, unknown>;
    instance_data?: Record<string, unknown>;
  };
  db_queue?: Array<{ profile_set?: unknown; origin?: unknown; collect_id?: unknown }>;
  karmalauters?: Record<string, TypeEntry>;
  karmalizers?: Record<string, TypeEntry>;
  is_new_game?: boolean;
  locale_persisted?: boolean;
  server_time?: { $date?: number };
  version?: unknown;
  game_values?: GameValuesPayload;
  [key: string]: unknown;
}

interface ServerNode {
  game_id?: string;
  game_type?: string;
  gestalt?: string;
  full_path?: string;
  full_type?: string;
  instance_data?: Record<string, unknown> & { amount?: number };
  type_data?: Record<string, unknown>;
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
  /** Returns a Date whose epoch-ms equals the ms remaining until the
   *  next AP tick — see Game.ts's APTicker singleton. */
  getRemainingTime?(): Date;
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

// Missions: imported as a real class above — fields/methods used by
// `updateGameValues` (`updateMissions`), `makeNotifications`
// (`getMission`), and `loadGame` (`initMissions`).

/** Notification cue payload — what `cueNotification` queues and
 *  `openNotification` renders.  All fields are emergent from the
 *  many `makeNotifications` branches; no single source of truth.
 *  Field types include `| undefined` so the partial-construction
 *  pattern (`const n: Notification = {}; n.x = maybe()`) round-trips
 *  under `exactOptionalPropertyTypes`. */
interface Notification {
  game_type?: string | undefined;
  config?: NotificationConfig | undefined;
  states?: Record<string, boolean> | undefined;
  scriptedEvents?: Array<() => void> | undefined;
  mission?: unknown;
  mission_active_gestalt?: string | undefined;
  mission_decorator?: string | undefined;
  perp?: { data: Record<string, unknown> } | undefined;
  title?: string | undefined;
  text?: string | undefined;
  says?: string | undefined;
  description?: string | undefined;
  selectortitle?: string | undefined;
  karma_dec?: number | undefined;
  button?: string | undefined;
  providedKarma?: ProvidedKarmaRow[] | undefined;
  data?: Record<string, unknown> | undefined;
  // Tutorial scripted-event fields (compiled into scriptedEvents):
  viewmap?: string | undefined;
  viewmapPos?: { x: number; y: number } | undefined;
  buyPerp?: string | undefined;
  buyParent?: string | undefined;
  buyPerpPos?: { x: number; y: number } | undefined;
  integrateProfileSet?: string | undefined;
  nodelay?: boolean | undefined;
  nonblocking?: number | undefined;
  [key: string]: unknown;
}

interface NotificationConfig {
  template?: string;
  /**
   * Phase 2 (issue #80) Preact replacement for `template`.  When set,
   * `openNotification` resolves the spec via `resolveDialog` and routes
   * the cue through the Preact dialog manager instead of constructing a
   * `Render.Popup` with an Underscore.js template.  The `DialogSpec`
   * union type-checks each cue's props against its component, so a
   * prop rename surfaces a compile error here rather than silently
   * breaking the popup.
   */
  dialog?: DialogSpec;
  extendClass?: string;
  delay?: number;
  delayScript?: number;
  placeBottom?: boolean;
  templateData?: unknown;
  popupContainer?: unknown;
  [key: string]: unknown;
}

/** Karmalauter-typed entry compiled by `compileProvidedKarma`.
 *  Pushed onto `data.providedKarma` and into popup_karma.html. */
interface ProvidedKarmaRow {
  gestalt: string;
  data: Record<string, unknown> & {
    slot_background?: unknown;
    required_level?: number;
    price?: number;
    karma_points?: number;
  };
  locked?: boolean;
}

/** Server payload to `makeNotifications`.  Each top-level field is
 *  an independent branch (mission_complete, levelup, perps, …) and
 *  fires its own cue. */
interface MakeNotificationsPayload {
  mission_complete?: string;
  mission_active?: string;
  levelup?: number | true;
  perps?: string[];
  powerups?: Record<string, Array<{ game_gestalt: string; [key: string]: unknown }>>;
  karma?: { gestalt: string; dec: number; karma_value?: number };
  simplemessage?: { text: string };
  story?: { text: string };
  storyPerp?: GameNode & {
    ViewMap?: { id?: string };
    renderNode?: { getPosition?(): { x: number; y: number } };
  };
  tutorial?: Notification[];
  [key: string]: unknown;
}

/** Subclass-method surfaces touched by `makeNotifications`'s
 *  `data.perps` and `data.powerups` branches. */
interface NewItemsLike {
  markNewItems?(): void;
  checkProvidedByLevel?(): void;
  checkProvidedByRequiredPerps?(): void;
  highlightTabs?: string[];
}

// File-local versions of the stopPropagation / preventDefault narrows
// (the class-level protected statics on GameNode aren't reachable
// from free functions in this module).
function _stopPropFile(e: unknown): void {
  const fn = (e as { stopPropagation?: () => void } | null | undefined)?.stopPropagation;
  if (typeof fn === 'function') fn.call(e);
}
function _preventDefaultFile(e: unknown): void {
  const fn = (e as { preventDefault?: () => void } | null | undefined)?.preventDefault;
  if (typeof fn === 'function') fn.call(e);
}

/** Maps LocalEngine.importSave's `{result: ImportSaveResult}` onto the
 *  AboutPopup's framework-agnostic ImportOutcome.  Unknown shapes degrade to a
 *  generic 'malformed' error rather than throwing. */
function _normalizeImport(data: unknown): ImportOutcome {
  const result = (data as { result?: unknown } | undefined)?.result as
    | { ok?: boolean; cancelled?: boolean; error?: 'malformed' | 'version' | 'unavailable' }
    | undefined;
  if (result?.ok) return { status: 'ok' };
  if (result?.cancelled) return { status: 'cancelled' };
  if (result?.error) return { status: 'error', errorKind: result.error };
  return { status: 'error', errorKind: 'malformed' };
}

/** First-boot / settings language picker overlay.  jQuery-driven DOM
 *  injection; on locale-pick fires `app.remote.setLocale` and
 *  reloads.  Used by `loadGame` (no-dismiss) and the `toggle_locale`
 *  event handler (dismissable). */
function _showLangPicker(canDismiss: boolean): void {
  const $ = globalThis.$;
  if (!$) return;
  // Touch devices fire both `touchend` and a synthesized `click` for the
  // same tap on the toggle, so the event handler can request the picker
  // twice in quick succession.  Bail if an overlay is already mounted.
  if (document.querySelector('.LangSelectOverlay')) return;
  const $overlay = $(
    '<div class="LangSelectOverlay" style="position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.75);z-index:9999;display:flex;align-items:center;justify-content:center;">' +
      '<div class="LangPickerBox" style="background:#BFE7F5;border:3px solid #009FD9;border-radius:12px;padding:24px 32px;text-align:center;box-shadow:3px 3px 0px #009FD9,3px 3px 8px rgba(0,0,0,0.5);">' +
      '<div style="font-family:Bowlby;color:#009FD9;font-size:20px;margin-bottom:16px;">Choose your language<br>Sprache wählen</div>' +
      '<div style="display:flex;gap:16px;justify-content:center;">' +
      '<div class="Button lang-pick" data-locale="en">🇺🇸🇬🇧🇦🇺 EN</div>' +
      '<div class="Button lang-pick" data-locale="de">🇩🇪🇦🇹🇨🇭 DE</div>' +
      '</div>' +
      '</div>' +
      '</div>'
  ) as unknown as {
    on(
      ev: string,
      sel: string | ((e: unknown) => void),
      cb?: (this: unknown, e: unknown) => void
    ): void;
    find(sel: string): { addClass(c: string): void };
    remove(): void;
  };
  $('body').append?.($overlay);
  let picked = false;
  $overlay.on('click touchend', '.lang-pick', function (this: unknown, e: unknown) {
    _stopPropFile(e);
    _preventDefaultFile(e);
    if (picked) return;
    picked = true;
    const chosen = ($(this as object) as unknown as { data(k: string): string }).data('locale');
    $overlay.find('.lang-pick').addClass('disabled');
    const remote = appModule.getApplication().remote as {
      setLocale?(locale: string): { done(cb: () => void): unknown };
    };
    remote.setLocale?.(chosen).done(() => location.reload());
  });
  if (canDismiss) {
    $overlay.on('click touchend', (e: unknown) => {
      const target = (e as { target?: object } | null | undefined)?.target;
      if (!target) return;
      const closest = (
        $(target) as unknown as { closest(sel: string): { length: number } }
      ).closest('.LangPickerBox');
      if (!closest.length) {
        _preventDefaultFile(e);
        $overlay.remove();
      }
    });
  }
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
  NotificationQueue: Notification[] = [];
  /** `raw_data` mirrors the engine's authoritative state snapshot for
   *  read-only helpers (mission-briefing-seen lookup, etc.).  Set by
   *  `loadGame` (still in Game.js). */
  raw_data?: {
    mission_briefings_seen?: Record<string, boolean>;
    tokens_seen?: Record<string, unknown>;
    [key: string]: unknown;
  };

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
  xp_level: Level = emptyLevel();
  /** Set by `loadGame` (still in Game.js) once the Missions singleton
   *  is constructed.  Forward-ref optional until Missions extracts. */
  Missions?: Missions;
  data: {
    status_icons?: unknown;
    status_bar?: StatusBarData;
    width?: number;
    height?: number;
    levels?: Level[];
    game_values?: GameValuesPayload;
    providedKarma?: ProvidedKarmaRow[];
    slot_background?: unknown;
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

  // View tabs — set by `loadGame`.  `getImperium` / `getDatabase`
  // are wrapper accessors used elsewhere; declared as real methods
  // below.
  Imperium?: Imperium;
  Database?: Database;
  Topscores?: Topscores;
  /** User profile data passed through to MainMenu render config. */
  userdata?: unknown;
  /** APTicker singleton handle — assigned by `loadGame` from the
   *  Game.js-side seed (`setAPTickerForGameRoot`).  Read by Render.js
   *  for the no_AP decorator's "more in" hint. */
  APTicker?: APTickerLike;

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

  /** True when any compiled origin token points back to the given
   *  origin (city/profileset) gestalt. Used by tutorial step-skip
   *  logic to detect that a profileset has already been integrated. */
  hasOriginTokenForOrigin(originGestalt: string): boolean {
    return Object.values(this.DBOriginTokens).some(
      (ot) => ot.originGameNode?.gestalt === originGestalt
    );
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
  // Camera / zoom
  // -------------------------------------------------------------------

  /** The active ViewMap for camera math — `activeView` if set,
   *  otherwise Imperium.  `getImperium` lives on the not-yet-extracted
   *  Game.js side; the optional-chain handles the load-order window
   *  before `loadGame` runs.  Returns `undefined` when no view is
   *  available. */
  private _resolveActiveViewMap(): ViewMapRenderLike | undefined {
    const view = this.activeView ?? this.getImperium();
    return view?.renderNode as ViewMapRenderLike | undefined;
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
      const view = this.activeView ?? this.getImperium();
      const vm = view?.renderNode as ViewMapRenderLike | undefined;
      if (!vm?.scroller || !vm.parentNode) return;
      const vw = vm.parentNode.width ?? 0;
      const vh = vm.parentNode.height ?? 0;
      // `vm.width` / `homeX` are in unscaled native ViewMap coords;
      // the scroller's scrollTo + its `__maxScrollLeft` clamp operate
      // in scaled-content space.  Scale before clamping so the
      // bounds are correct at non-1 zoom levels (default Imperium
      // zoom is 0.75).
      const zoom = vm.zoomScale ?? 1;
      const maxX = Math.max(0, (vm.width ?? 0) * zoom - vw);
      const maxY = Math.max(0, (vm.height ?? 0) * zoom - vh);

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

      const sx = Math.max(0, Math.min(maxX, homeX * zoom - vw / 2));
      const sy = Math.max(0, Math.min(maxY, homeY * zoom - vh / 2));
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
    const imperium = this.getImperium();
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
  // Status bar / level / XP
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
    return levels[idx] ?? emptyLevel();
  }

  /** Returns the Level `xp` resolves to, or an empty Level-shape when
   *  `xp` is falsy.  Legacy returned `{}` for the falsy branch —
   *  flattened to a Level-shaped sentinel to keep the strict-TS
   *  signature clean (callers pass it to `setLevel`'s identity check,
   *  never read fields off it).
   *
   *  Ruleset levels leave a one-XP gap between consecutive ranges
   *  (L1: 0–10, L2: 11–30, …).  `xp_max` is the promotion threshold:
   *  xp landing exactly on a level's `xp_max` resolves to the *next*
   *  level, mirroring the engine's `_getLevelByXP`.  The old inclusive
   *  `xp <= xp_max` match kept it on the lower level, which made
   *  `setXP` and `setLevel` recurse forever on the boundary value
   *  (RangeError / stack overflow surfacing in `FXSimpleCue`). */
  getLevelByXP(xp?: number): Level {
    if (!xp) {
      return emptyLevel();
    }
    const levels = this.data.levels ?? [];
    for (let i = levels.length - 1; i >= 0; i--) {
      const lvl = levels[i];
      if (lvl && xp >= lvl.xp_min) {
        const next = levels[i + 1];
        if (next && xp >= lvl.xp_max) return next;
        return lvl;
      }
    }
    return emptyLevel();
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
  // Game values
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
      // Legacy passed `game_values` as the 2nd arg; the method
      // signature only accepts one — preserved as a no-op drop.
      this.Missions?.updateMissions(missions as Parameters<Missions['updateMissions']>[0]);
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
      this.useAP(gv.ap_increment, silent);
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
      (
        this.getDatabase() as (Database & { checkNotifications?(): void }) | undefined
      )?.checkNotifications?.();
      this.makeNotifications({ levelup: this.xp_level.number });
    }
  }

  /** Additive AP delta wrapper.  `silent` forwards to `setAP` so
   *  silent updateGameValues paths don't flicker the AP bar — fixed
   *  in #228 (closes #207).  Legacy Game.js passed `silent` here
   *  but `useAP`'s signature only ever accepted one arg, so the
   *  silent flag was dropped at the call boundary. */
  useAP(inc: number, silent?: boolean): void {
    this.setAP(this.ap_value + inc, silent);
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

  /** Snap the displayed AP back down to an authoritative engine
   *  snapshot.  Spend handlers call this on an insufficient-AP
   *  rejection: the free-running APTicker estimate (`ap_value += inc`)
   *  can drift above the engine's materialized `ap_snapshot`, and the
   *  rejection path never went through `updateGameValues`, so without
   *  this the bar stays showing phantom energy the engine has already
   *  refused and every retry fails identically. */
  reconcileAP(result: unknown): void {
    const snap = (result as { ap_snapshot?: unknown } | null | undefined)?.ap_snapshot;
    // Mirror updateGameValues' guard: skip the statusbar re-render when the
    // authoritative value already matches what's shown.
    if (typeof snap === 'number' && snap !== this.ap_value) this.setAP(snap);
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
    // `setLevel` calls back into `setXP`, so only re-enter it when the
    // XP actually resolves to a *different* level.  Without the
    // `resolved.number !== this.xp_level.number` guard, an `xp_value`
    // sitting on a level boundary (e.g. exactly L1.xp_max) keeps
    // resolving to the level we're already on and the two methods
    // recurse until the stack overflows.
    const resolved = this.getLevelByXP(this.xp_value);
    if (
      resolved.number !== this.xp_level.number &&
      (this.xp_value >= this.xp_level.xp_max || this.xp_value < this.xp_level.xp_min)
    ) {
      this.setLevel(resolved.number);
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
  // Notifications + Karmalauter buy flow (extracted in PR 23 of #147)
  // -------------------------------------------------------------------

  cueNotification(notification: Notification): void {
    this.NotificationQueue.push(notification);
  }

  /** No-op stub preserved from legacy.  Likely intended to kick the
   *  queue but never wired — `openNotification` runs at the tail of
   *  `makeNotifications` instead. */
  startNotificationQueue(): void {}

  uncueNotification(notification: Notification): void {
    const index = this.NotificationQueue.indexOf(notification);
    if (index !== -1) this.NotificationQueue.splice(index, 1);
  }

  compileProvidedKarma(): ProvidedKarmaRow[] {
    this.data.providedKarma = [];
    this.getTypes('Karmalauter').forEach((v) => {
      const td = (v.type_data ?? {}) as ProvidedKarmaRow['data'];
      // Mutates the shared typeRegistry entry through `v.type_data`'s
      // reference — idempotent (same value every call); legacy
      // preserved the side effect.  See the popup_karma.html template
      // which reads `slot_background` off each row's `data`.
      td.slot_background = this.data.slot_background;
      const row: ProvidedKarmaRow = {
        gestalt: v.gestalt ?? '',
        data: td,
      };
      // FIXME: lock level
      if ((td.required_level ?? 0) > this.xp_level.number) row.locked = true;
      this.data.providedKarma?.push(row);
    });
    this.data.providedKarma = (this.data.providedKarma ?? []).slice().sort((a, b) => {
      return (a.data.price ?? 0) - (b.data.price ?? 0);
    });
    return this.data.providedKarma;
  }

  BuyKarma(bgestalt: string): void {
    const remote = appModule.getApplication().remote as {
      buyKarma?(g: string): {
        done(
          cb: (data: {
            result?: {
              error?: number;
              game_values?: GameValuesPayload;
              levelup?: boolean;
              missions?: unknown;
            };
          }) => void
        ): unknown;
      };
    };
    const fn = remote.buyKarma;
    if (!fn) return;
    fn(bgestalt).done((data) => {
      if (!data.result) {
        this.Error?.('The computer says NOOOO', data);
        return;
      }
      const r = data.result;
      if (r.error !== undefined) {
        // Probably no cash
        if (this.renderPopup && this.renderPopup.open) {
          this.renderPopup.trigger('no_cash');
        } else {
          this.renderNode?.FXNoCash?.();
        }
        return;
      }
      const td = this.getTypeData(bgestalt) as { karma_points?: number } | undefined;
      const karma_points = td?.karma_points ?? 0;
      const karma_value = this.karma_value;
      const karma_up = karma_points + karma_value <= 100 ? karma_points : 100 - karma_value;
      if (this.renderPopup) {
        this.renderPopup.trigger('popup_close');
        this.renderNode?.FXKarmaBling?.(karma_up);
      }
      if (this.notificationPopup) {
        this.notificationPopup.trigger('popup_close');
        this.renderNode?.FXKarmaBling?.(karma_up);
      }
      // TODO: Karma Up Animation?
      this.updateGameValues(r.game_values ?? {}, r.levelup === true, r.missions);
    });
  }

  /** Open a Preact dialog through the phase-2 `dialogManager`.  Wires
   *  the resulting handle into `this.renderPopup` (or `notificationPopup`
   *  when `slot: 'notification'`) so legacy callers that do
   *  `groot.renderPopup.trigger('popup_close')` still find a compatible
   *  handle to drive.  Clears that slot automatically on close. */
  openPreactDialog<P extends Record<string, unknown>>(
    component: ComponentType<P & { onClose: () => void }>,
    props: P,
    options: {
      extendClass?: string;
      placeBottom?: boolean;
      slot?: 'popup' | 'notification';
      onAfterClose?: () => void;
    } = {}
  ): PreactDialogHandle | undefined {
    const container = (
      this.renderNode as { popupContainerDomelem?: { 0?: HTMLElement } } | undefined
    )?.popupContainerDomelem?.[0];
    if (!container) return undefined;
    const slot = options.slot ?? 'popup';
    const handle = openDialog<P>({
      component,
      props,
      container,
      ...(options.extendClass !== undefined && { extendClass: options.extendClass }),
      ...(options.placeBottom !== undefined && { placeBottom: options.placeBottom }),
      onAfterClose: () => {
        if (slot === 'notification') {
          delete this.notificationPopup;
        } else {
          delete this.renderPopup;
        }
        options.onAfterClose?.();
      },
    });
    if (slot === 'notification') {
      this.notificationPopup = handle as unknown as NonNullable<typeof this.notificationPopup>;
    } else {
      this.renderPopup = handle as unknown as NonNullable<typeof this.renderPopup>;
    }
    return handle;
  }

  openNotification(notification: Notification): RenderPopupLike | undefined {
    const config = (notification.config ?? {}) as NotificationConfig;
    if (this.notificationPopup) return undefined;

    // Phase 2 (issue #80) — tier 2+ cues carry a typed `config.dialog`
    // spec and route through the dialog manager.  The stub handle
    // holds the `notificationPopup` slot synchronously (mirroring the
    // legacy code that constructs `Render.Popup` before the `delay`
    // setTimeout) so concurrent cues can't double-open in the window
    // before the manager mounts.
    if (config.dialog) {
      const resolved = resolveDialog(config.dialog);
      const drainOnClose = (): void => {
        // Mission briefings persist their dismissal so the popup
        // doesn't re-queue on webxdc replay.  The legacy template
        // path did this via `popup.notificationMission` →
        // `GameNode.initPopupEvents` popup_close; the Preact path has
        // no initPopupEvents, so fire the op here instead.
        const missionGestalt = notification.mission_active_gestalt;
        if (missionGestalt) {
          const remote = appModule.getApplication().remote as {
            dismissMissionBriefing?(g: string): unknown;
          };
          remote.dismissMissionBriefing?.(missionGestalt);
        }
        this.uncueNotification(notification);
        const next = this.NotificationQueue[0];
        if (next) this.openNotification(next);
      };

      let isOpen = true;
      let liveHandle: PreactDialogHandle | undefined;

      const closeFromStub = (): void => {
        if (!isOpen) return;
        isOpen = false;
        if (liveHandle) {
          liveHandle.close();
          return;
        }
        delete this.notificationPopup;
        drainOnClose();
      };

      const stub: PreactDialogHandle = {
        get open() {
          return isOpen;
        },
        trigger(event: string) {
          if (event === 'popup_close' || event === 'popup_cancel') closeFromStub();
        },
        on() {
          // No-op: notification cues have no `button_click` handlers
          // bound to the pre-mount stub.
        },
        render() {},
        close: closeFromStub,
      };
      this.notificationPopup = stub as unknown as NonNullable<typeof this.notificationPopup>;

      window.setTimeout(() => {
        // Skip if the cue was dismissed during the delay window —
        // story tutorials' scripted events pan the camera, which
        // would jump to a perp for a popup the player already closed.
        if (!isOpen) return;
        notification.scriptedEvents?.forEach((s) => s());
      }, config.delayScript ?? 0);

      window.setTimeout(() => {
        if (!isOpen) return;
        delete this.notificationPopup;
        liveHandle = this.openPreactDialog(
          resolved.component as ComponentType<Record<string, unknown> & { onClose: () => void }>,
          resolved.props,
          {
            ...(config.extendClass !== undefined && { extendClass: config.extendClass }),
            ...(config.placeBottom !== undefined && { placeBottom: config.placeBottom }),
            slot: 'notification',
            onAfterClose: drainOnClose,
          }
        );
        if (!liveHandle) {
          isOpen = false;
          drainOnClose();
          return;
        }
        // The `karma` cue is the one interactive notification variant
        // (PerpBuyButton → BuyKarma, MainButton → close).  The other
        // variants are presentational; only karma needs the GameNode
        // button seam wired onto its live handle.
        if (config.dialog?.variant === 'karma') {
          this.initPopupEvents?.(liveHandle as unknown as RenderPopupLike);
        }
        if (notification.nonblocking) {
          window.setTimeout(() => liveHandle?.close(), notification.nonblocking);
        }
      }, config.delay ?? 0);

      return undefined;
    }

    // Every notification cue carries a typed `config.dialog` (mission /
    // levelup / perps / powerups / karma / simplemessage / story /
    // tutorial), so the legacy `Render.Popup` + Underscore-template
    // notification path was removed with the rest of the legacy engine.
    return undefined;
  }

  /** Build notification cues from the server's payload and kick the
   *  queue.  Each top-level field of `data` is an independent branch
   *  (mission / levelup / perps / powerups / karma / simplemessage /
   *  story / tutorial); cues land in `NotificationQueue`, are sorted
   *  by `sort_types` priority, then `openNotification` fires for the
   *  head. */
  makeNotifications(data: MakeNotificationsPayload): void {
    const speed = setup.debug ? 0 : 1;

    // Project only the perp fields `NewItemsNotification` actually
    // reads, so the cue closure (which lives in `NotificationQueue`
    // until drained) doesn't pin the full `type_data` object.
    const wireNewItemsCue = (n: Notification): void => {
      const pdata = (n.perp?.data ?? {}) as {
        popup_sprite?: SpriteHelperConfig;
        title?: string;
        subtitle?: string;
        description?: string;
      };
      (n.config as NotificationConfig).dialog = {
        variant: 'newItems',
        props: {
          title: n.title,
          says: n.says,
          textHtml: n.text,
          perp: {
            data: {
              popup_sprite: pdata.popup_sprite,
              title: pdata.title,
              subtitle: pdata.subtitle,
              description: pdata.description,
            },
          },
        },
      };
    };

    if (data.mission_complete && this.Missions) {
      const mission = this.Missions.getMission(data.mission_complete);
      const mdata = (mission.data ?? {}) as Record<string, unknown>;
      const n: Notification = mergeData({}, mission.data) as Notification;
      n.game_type = 'MissionComplete';
      n.mission_decorator = i18n.gettext('Mission complete!');
      n.states = mission.states;
      n.config = {
        dialog: {
          variant: 'missionComplete',
          props: buildMissionPopupProps({
            data: mdata,
            states: mission.states,
            decorator: i18n.gettext('Mission complete!'),
            variant: 'complete',
            getType: (g) => this.getType(g),
            getTypeData: (g) => this.getTypeData(g),
          }),
        },
        extendClass: 'Mission',
        delay: 2500,
        delayScript: 1000,
      };
      n.scriptedEvents = [
        () => {
          this.renderNode?.FXMissionComplete?.();
        },
      ];
      this.cueNotification(n);
    }
    if (data.mission_active && this.Missions) {
      // Only show the briefing if the player hasn't already
      // dismissed it.  The seen-flag is persisted via the
      // dismissMissionBriefing op so it survives webxdc replay
      // across reloads.
      const seenBriefings = this.raw_data?.mission_briefings_seen ?? {};
      if (!seenBriefings[data.mission_active]) {
        const mission = this.Missions.getMission(data.mission_active);
        const mdata = (mission.data ?? {}) as Record<string, unknown>;
        const n: Notification = mergeData({}, mission.data) as Notification;
        n.game_type = 'MissionNew';
        n.states = mission.states;
        n.mission_decorator = i18n.gettext('New Mission!');
        n.mission = mission;
        n.mission_active_gestalt = data.mission_active;
        n.config = {
          dialog: {
            variant: 'missionBriefing',
            props: buildMissionPopupProps({
              data: mdata,
              states: mission.states,
              decorator: i18n.gettext('New Mission!'),
              variant: 'briefing',
              getType: (g) => this.getType(g),
              getTypeData: (g) => this.getTypeData(g),
            }),
          },
          extendClass: 'Mission',
        };
        this.cueNotification(n);
      }
    }
    if (data.levelup) {
      // Snapshot xp_level at cue time so the component is pure — the
      // popup opens `delay` ms later and xp_level may have drifted.
      const xpLevel = this.xp_level.number;
      const xpToNext = this.xp_level.xp_max - this.xp_value;
      const apMax = this.xp_level.ap_max;
      const n: Notification = {
        game_type: 'LevelUp',
        config: {
          dialog: { variant: 'levelup', props: { xpLevel, xpToNext, apMax } },
          extendClass: 'Tutorial',
          placeBottom: true,
          delay: 1200,
        },
        scriptedEvents: [
          () => {
            this.renderNode?.FXLevelUpBling?.(data.levelup as number | true);
          },
        ],
      };
      this.cueNotification(n);
    }
    // FIXME: this turns off notifications during tutorials in
    // general; currently only set by level.
    if (data.perps && this.xp_level.number > this.notification_level) {
      data.perps.forEach((gestalt) => {
        const type = this.getType(gestalt);
        const tdata = this.getTypeData(gestalt);
        if (!type || !tdata || getByGestalt(gestalt)) return;
        const n: Notification = {
          game_type: type.game_type,
          config: { extendClass: 'NewItems' },
        };
        let parentIsBuilt = false;
        const parentTypes = this.getParentTypes(gestalt);
        parentTypes.forEach((parentType) => {
          const parentTypeData = parentType.type_data as
            | { title?: string; [k: string]: unknown }
            | undefined;
          const parentsBuilt = getAllByGestalt(parentType.gestalt ?? '').length;
          if (parentsBuilt > 0) parentIsBuilt = true;
          n.perp = { data: tdata };
          n.title = (tdata as { ntitle?: string }).ntitle;
          n.says = i18n.gettext('Mark says:');
          const ntext = (tdata as { ntext?: string }).ntext ?? '';
          if (parentTypeData?.title) {
            n.text = sprintf(ntext, span(parentTypeData.title));
            eachByGestalt(parentType.gestalt ?? '', (v) => {
              if (v.renderNode) {
                const sub = v as GameNode & NewItemsLike;
                sub.markNewItems?.();
                sub.checkProvidedByLevel?.();
                sub.checkProvidedByRequiredPerps?.();
                sub.highlightTabs = sub.highlightTabs ?? [];
                if (n.game_type) sub.highlightTabs.push(n.game_type);
              }
            });
          } else {
            n.text = sprintf(ntext, span((tdata as { title?: string }).title ?? ''));
          }
        });
        if (parentIsBuilt) {
          wireNewItemsCue(n);
          this.cueNotification(n);
        }
      });
    }
    // Powerup Notifications.  FIXME same as `data.perps`.
    if (data.powerups && this.xp_level.number > this.notification_level) {
      // remap the response and prepare the types' data.
      interface PowReg {
        game_type?: string | undefined;
        type_data?:
          | (Record<string, unknown> & { ntitle?: string; ntext?: string; notification?: boolean })
          | undefined;
        projects: Array<
          GameNode &
            NewItemsLike & {
              addType?(g: string, d: unknown): void;
              getType?(g: string): TypeEntry | undefined;
              data?: { title?: string; [k: string]: unknown };
            }
        >;
      }
      const pow_register: Record<string, PowReg> = {};
      Object.entries(data.powerups).forEach(([projectgestalt, project_pows]) => {
        const project = getByGestalt(projectgestalt) as
          | (GameNode &
              NewItemsLike & {
                addType?(g: string, d: unknown): void;
                getType?(g: string): TypeEntry | undefined;
                data?: { title?: string; [k: string]: unknown };
              })
          | undefined;
        if (!project) return;
        project_pows.forEach((powerup) => {
          const powgestalt = powerup.game_gestalt;
          if (!project.getType?.(powgestalt)) project.addType?.(powgestalt, powerup);
          const powerup_type = project.getType?.(powgestalt) as TypeEntry | undefined;
          if (!powerup_type) return;
          const reg = (pow_register[powgestalt] ??= { projects: [] });
          reg.game_type = powerup_type.game_type;
          reg.type_data = powerup_type.type_data as PowReg['type_data'];
          if (!reg.projects.includes(project)) reg.projects.push(project);
        });
      });

      Object.values(pow_register).forEach((reg) => {
        const n: Notification = {
          config: { extendClass: 'NewItems' },
          game_type: reg.game_type,
          perp: { data: reg.type_data ?? {} },
          title: reg.type_data?.ntitle,
        };
        let projectstext = '';
        // add those decorators and make the projects notification text
        reg.projects.forEach((project, k) => {
          project.markNewItems?.();
          project.highlightTabs = project.highlightTabs ?? [];
          if (n.game_type) project.highlightTabs.push(n.game_type);
          const sep = k < reg.projects.length - 1 ? ', ' : '';
          projectstext = projectstext + (project.data?.title ?? '') + sep;
        });
        n.says = i18n.gettext('Mark says:');
        n.text = sprintf(reg.type_data?.ntext ?? '', span(projectstext));
        wireNewItemsCue(n);
        // popup only if notification = true;
        if (reg.type_data?.notification) this.cueNotification(n);
      });
    }
    // Karmalizer Notification
    if (data.karma) {
      this.compileProvidedKarma();
      const gestalt = data.karma.gestalt;
      const td = this.getTypeData(gestalt) as Record<string, unknown> | undefined;
      const n: Notification = { ...(td ?? {}) };
      n.selectortitle = i18n.gettext('Choose your counter measures');
      n.karma_dec = data.karma.dec;
      n.button = i18n.gettext('Do nothing');
      n.providedKarma = this.data.providedKarma;
      const type = this.getType(gestalt);
      n.game_type = type?.game_type;
      const ctx = buildProvidedContext(
        this as unknown as Parameters<typeof buildProvidedContext>[0]
      );
      const vm = buildKarmaPopupVM(
        n as Parameters<typeof buildKarmaPopupVM>[0],
        this.karma_value,
        ctx
      );
      n.config = {
        dialog: { variant: 'karma', props: { vm } },
        extendClass: 'Alert',
        delay: 650,
      };
      this.cueNotification(n);
    }

    // Simplemessage
    if (data.simplemessage) {
      const description = data.simplemessage.text;
      const says = i18n.gettext('Mark says:');
      this.cueNotification({
        game_type: 'Story',
        button: i18n.gettext('Next'),
        description,
        says,
        config: {
          dialog: { variant: 'tutorial', props: { says, descriptionHtml: description } },
          extendClass: 'Tutorial',
          placeBottom: true,
          delay: 0,
        },
      });
    }

    // Tutorials and Missions
    if (data.story && data.storyPerp) {
      const storyPerp = data.storyPerp;
      const description = data.story.text;
      const says = i18n.gettext('Mark says:');
      this.cueNotification({
        game_type: 'Story',
        button: i18n.gettext('Next'),
        description,
        says,
        scriptedEvents: [
          () => {
            const viewMapId = storyPerp.ViewMap?.id;
            if (viewMapId) this.trigger('switch_view', [viewMapId]);
            const pos = storyPerp.renderNode?.getPosition?.();
            const av = this.activeView?.renderNode;
            if (pos && av?.scrollTo) av.scrollTo(pos, 1000);
          },
        ],
        config: {
          dialog: { variant: 'tutorial', props: { says, descriptionHtml: description } },
          extendClass: 'Tutorial',
          placeBottom: true,
          delay: 0,
        },
      });
    }
    if (data.tutorial) {
      data.tutorial.forEach((tutorial) => {
        const n: Notification = tutorial;
        n.button = i18n.gettext('Next');
        n.says = i18n.gettext('Mark says:');
        const description = (n.description ?? '') as string;
        const says = n.says;
        n.config = {
          dialog: { variant: 'tutorial', props: { says, descriptionHtml: description } },
          extendClass: 'Tutorial',
          placeBottom: true,
          delay: 600 * speed,
          delayScript: 0,
        };
        n.game_type = 'Tutorial';
        // TODO: handle/compile scripted events.  See legacy comments
        // in Game.js for the field-by-field plan.
        n.scriptedEvents = [];
        if (n.viewmap) {
          n.config.delay = 0;
          // FIXME: Hack for CMS fail
          n.scriptedEvents.push(() => {
            if (n.viewmap === 'empire001') n.viewmap = 'Imperium';
            if (n.viewmap === 'database001') n.viewmap = 'Database';
            if (n.viewmap) this.trigger('switch_view', [n.viewmap]);
          });
        }
        if (n.viewmapPos) {
          n.config.delay = (n.nodelay ? 500 : 1000) * speed;
          n.scriptedEvents.push(() => {
            const av = this.activeView?.renderNode;
            if (n.viewmapPos && av?.scrollTo) {
              av.scrollTo({ x: n.viewmapPos.x, y: n.viewmapPos.y }, 1000);
            }
          });
        }
        if (n.buyPerp && n.buyParent) {
          const existing = getByGestalt(n.buyPerp);
          n.config.delay = (existing ? 650 : n.nodelay ? 500 : 3000) * speed;
          n.scriptedEvents.push(() => {
            if (!n.buyParent || !n.buyPerp) return;
            const parentNode = getByGestalt(n.buyParent) as
              | (GameNode & {
                  renderNode?: {
                    DecoratorNew?: { remove(): void };
                    getPosition?(): { x: number; y: number };
                  };
                  BuyPerp?(g: string, pos?: { x: number; y: number }): void;
                })
              | undefined;
            if (!parentNode) return;
            parentNode.renderNode?.DecoratorNew?.remove();
            const buyPerp = getByGestalt(n.buyPerp) as
              | { renderNode?: { getPosition?(): { x: number; y: number } } }
              | undefined;
            if (!buyPerp) {
              parentNode.BuyPerp?.(n.buyPerp, n.buyPerpPos);
            } else {
              const pos = buyPerp.renderNode?.getPosition?.();
              const av = this.activeView?.renderNode;
              if (pos && av?.scrollTo) {
                av.scrollTo({ x: pos.x, y: pos.y - 40 });
              }
            }
          });
        }
        if (n.integrateProfileSet) {
          n.config.delay = (n.nodelay ? 500 : 5000) * speed;
          n.scriptedEvents.push(() => {
            const db = this.getDatabase?.() as
              | {
                  queue?: { set?: Array<{ origin?: { gestalt?: string }; psid?: string }> };
                  mergeCued?(psid: string): void;
                }
              | undefined;
            const ps = db?.queue?.set?.find((p) => p.origin?.gestalt === 'city002');
            if (ps?.psid && db?.mergeCued) db.mergeCued(ps.psid);
          });
        }
        this.cueNotification(n);
      });
    }

    // sort em by type!
    const sort_types = [
      'Error',
      'Story',
      'MissionComplete',
      'LevelUp',
      'Tutorial',
      'Karmalizer',
      'CityPerp',
      'ProxyPerp',
      'ProjectPerp',
      'AgentPerp',
      'ContactPerp',
      'PusherPerp',
      'ClientPerp',
      'TokenPerp',
      'UpgradePowerup',
      'AdPowerup',
      'TeamMemberPowerup',
      'MissionNew',
    ];
    this.NotificationQueue.sort((a, b) => {
      const ai = sort_types.indexOf(a.game_type ?? '');
      const bi = sort_types.indexOf(b.game_type ?? '');
      return ai - bi;
    });
    const head = this.NotificationQueue[0];
    if (head) this.openNotification(head);
  }

  // -------------------------------------------------------------------
  // View getters, BuyPerp dispatch, render hooks, refresh, loadGame
  // -------------------------------------------------------------------

  /** FIXME: this is just a wrapper. */
  getImperium(): Imperium | undefined {
    return this.Imperium;
  }

  /** FIXME: this is just a wrapper. */
  getDatabase(): Database | undefined {
    return this.Database;
  }

  /** Dispatches a buy by gestalt to the appropriate handler.
   *  CityPerp routes through DatabasePerp.BuyCity; Karmalauter goes
   *  to BuyKarma; everything else is the unhandled-error fallback.
   *  Note: legacy referenced an undeclared `data` var in the error
   *  path — preserved as `undefined` here (the call would have
   *  thrown ReferenceError at runtime, masking what was clearly a
   *  copy-paste bug). */
  BuyPerp(gestalt: string, placePos?: { x: number; y: number }): void {
    const gtype = this.getTypeFromGestalt(gestalt);
    if (gtype === 'CityPerp') {
      const dbPerps = getByType('DatabasePerp');
      const dbPerp = dbPerps[0] as
        | (GameNode & { BuyCity?(g: string, p?: { x: number; y: number }): void })
        | undefined;
      if (!dbPerp) return;
      dbPerp.BuyCity?.(gestalt, placePos);
      return;
    }
    if (gtype === 'Karmalauter') {
      this.BuyKarma(gestalt);
      return;
    }
    // Legacy referenced an undeclared `data` var here — preserved
    // as `undefined` (the call would have thrown ReferenceError at
    // runtime, masking what was clearly a copy-paste bug).
    this.Error('The computer says NOOOO', undefined);
  }

  /** Reload the game data and reinit the whole Game (like a page
   *  reload).  On retry-failure, escalates the retry interval and
   *  finally redirects to `/` if the cap is exceeded. */
  refresh(): void {
    this.retryDelay = this.retryDelay || 2000;
    this.lock();

    const app = appModule.getApplication() as {
      remote: {
        getSessionLocale?(): {
          then(onResolved: (data: { result?: string }) => unknown): {
            fail(cb: (data: unknown) => void): unknown;
          };
        };
        loadGame?(): { then(cb: (data: { result?: LoadGameData }) => void): unknown };
      };
      version?: unknown;
      renderView?(name: string): string;
    };
    const $ = globalThis.$;
    if (!app.remote.getSessionLocale || !$) return;
    const chain = app.remote.getSessionLocale().then((data) => {
      const locale = data.result === 'de' ? 'de_AT' : 'en_US';
      i18n.setLocale(locale);
      const html = app.renderView?.('game.html') ?? '';
      $('#dd-control').html(html);
      return app.remote.loadGame?.().then((d) => {
        const gameData = d.result;
        if (!gameData) return;
        app.version = gameData.version;
        const Game = appModule.getApplication() as unknown as { game?: GameRoot };
        // Re-init through the bootstrap path; Game.js's `init` factory
        // creates a fresh GameRoot and calls `loadGame(gameData)`.
        const init = (appModule.getApplication() as { init?: (d: LoadGameData) => unknown }).init;
        if (init) init(gameData);
        else if (Game.game) Game.game.loadGame(gameData);
      });
    });
    (chain as unknown as { fail(cb: (data: unknown) => void): void }).fail((_data) => {
      if (this.notificationPopup) {
        this.notificationPopup.trigger('error');
        window.setTimeout(() => {
          this.notificationPopup?.render?.();
        }, this.retryDelay);
        this.retryDelay = (this.retryDelay ?? 0) + 1000;
        if ((this.retryDelay ?? 0) > 6000) {
          document.location.href = '/';
        }
      }
    });
  }

  override extendRender(): void {
    const Render = getRender() as Pick<RenderApi, 'MainMenu' | 'Statusbar'>;
    if (this.renderMenu) this.renderMenu.remove();
    const menu = new Render.MainMenu({
      gameNode: this,
      data: {
        logo: {
          frameSrc: 'MainSprites.png',
          frameMap: { normal: { x: 1, y: 819, width: 222, height: 40 } },
          frame: 'normal',
          className: 'MainMenuLogo',
        },
        userdata: this.userdata,
        buttons: [],
      },
    } as unknown as ConstructorParameters<RenderApi['MainMenu']>[0]) as unknown as MainMenuLike & {
      domelem?: unknown;
    };

    this.initStatusBar();
    const statusbar = new Render.Statusbar(
      this.data.status_bar as unknown as ConstructorParameters<RenderApi['Statusbar']>[0]
    ) as unknown as RenderStatusbarLike & { domelem?: unknown };
    this.renderStatusbar = statusbar as NonNullable<typeof this.renderStatusbar>;

    const stage = this.renderNode as
      | (NonNullable<GameNode['renderNode']> & {
          gameNode?: GameNode;
          domelem?: unknown;
          addChild?(child: unknown): void;
        })
      | undefined;
    if (!stage) return;
    stage.gameNode = this;
    const $ = globalThis.$;
    if (!$) return;
    if (setup.debug) {
      $(setup.renderContainer).addClass?.('debugmode');
    }
    const containerSel = setup.renderContainer;
    $(containerSel).append(menu.domelem);
    menu.initUI?.();
    $(containerSel).append(stage.domelem);
    this.renderMenu = menu as NonNullable<typeof this.renderMenu>;
    stage.addChild?.(statusbar);
  }

  override initEventHandlers(): void {
    // FIXME: This event should be renamed as we are out of the test
    // phase – or are we?
    const remoteApi = appModule.getApplication().remote as {
      setPerpCoordinates?(rows: Array<[string, { x: number; y: number }]>): unknown;
      exportSave?(): unknown;
      importSave?(): {
        then(
          onResolved?: (...a: unknown[]) => unknown,
          onRejected?: (...a: unknown[]) => unknown
        ): unknown;
      };
    };
    this.on('saveCoordsQueue', (_e: unknown, path: unknown, pos: unknown) => {
      remoteApi.setPerpCoordinates?.([[path as string, pos as { x: number; y: number }]]);
    });
    this.on('saveCoords', (_e: unknown, path: unknown, pos: unknown) => {
      remoteApi.setPerpCoordinates?.([[path as string, pos as { x: number; y: number }]]);
    });

    this.on('switch_view', (e: unknown, view_id: unknown) => {
      _stopPropFile(e);
      const id = view_id as string;
      const buttons = (this.renderMenu?.data as { buttons?: Array<{ id: string }> } | undefined)
        ?.buttons;
      buttons?.forEach((button) => {
        if (id !== button.id) {
          getById(button.id)?.setState('active', false);
        }
      });
      const next = getById(id);
      if (!next) return;
      this.activeView = next as ViewLike;
      next.setState('active', true);
      // Refresh scroller dimensions in case the stage was resized
      // while this tab was inactive.  Tab switches preserve scroll
      // position; the reset-zoom button is the explicit way to
      // recentre.
      const vm = (next as ViewLike).renderNode;
      vm?.updateScroller?.();
    });

    this.on('toggle_locale', (e: unknown) => {
      _stopPropFile(e);
      _showLangPicker(true);
    });

    this.on('user_data', (e: unknown) => {
      _stopPropFile(e);
      const onExport = remoteApi.exportSave
        ? (): void => {
            remoteApi.exportSave?.();
          }
        : undefined;
      const onImport = remoteApi.importSave
        ? (): Promise<ImportOutcome> =>
            new Promise<ImportOutcome>((resolve) => {
              const chain = remoteApi.importSave?.();
              if (!chain) {
                resolve({ status: 'error', errorKind: 'unavailable' });
                return;
              }
              chain.then(
                (...args: unknown[]) => resolve(_normalizeImport(args[0])),
                () => resolve({ status: 'error', errorKind: 'malformed' })
              );
            })
        : undefined;
      this.openPreactDialog(
        AboutPopup,
        {
          locale: setup.locale ?? '',
          buttonLabel: i18n.gettext('Close'),
          ...(onExport && { onExport }),
          ...(onImport && { onImport }),
        },
        { extendClass: 'About' }
      );
    });

    this.on('click_status.karma', () => {
      const providedKarma = this.compileProvidedKarma();
      const ctx = buildProvidedContext(
        this as unknown as Parameters<typeof buildProvidedContext>[0]
      );
      const vm = buildKarmaPopupVM(
        {
          title: i18n.gettext('karma_popup title'),
          description: i18n.gettext('karma_popup description'),
          selectortitle: i18n.gettext('karma_popup selector title'),
          mainsprites_class: 'karma',
          providedKarma,
        },
        this.karma_value,
        ctx
      );
      this.openPreactDialog(
        ProvidedPerpPopup as unknown as ComponentType<{ vm: typeof vm } & { onClose: () => void }>,
        { vm },
        { slot: 'popup' }
      );
      // GameRoot extends GameNode → initPopupEvents wires
      // button_click.PerpBuyButton (→ BuyPerp → Karmalauter → BuyKarma)
      // + MainButton → popup_close on the parked handle.
      this.initPopupEvents?.();
    });

    // Status info popups (Profiles / Cash / AP / XP) — Preact port of
    // views/popup_status.html (issue #80 phase 2, tier 1).  Each
    // component owns its own i18n + formatting; call sites just hand
    // over the raw engine scalars they need.
    this.on('click_status.Profiles', () => {
      this.openPreactDialog(ProfilesStatusPopup, {
        profilesValue: this.profiles_value,
        profilesMax: this.profiles_max,
      });
    });

    this.on('click_status.Cash', () => {
      this.openPreactDialog(CashStatusPopup, { cashValue: this.cash_value });
    });

    this.on('click_status.AP', () => {
      let apRemaining: number | undefined;
      let apInterval: number | undefined;
      if (this.ap_value < this.xp_level.ap_max) {
        const apt = this.APTicker;
        const remaining = apt?.getRemainingTime?.();
        if (remaining != null) {
          apRemaining = +remaining;
          apInterval = apt?.interval;
        }
      }
      this.openPreactDialog(APStatusPopup, {
        apValue: this.ap_value,
        apMax: this.xp_level.ap_max,
        apRemaining,
        apInterval,
      });
    });

    this.on('click_status.XP', () => {
      this.openPreactDialog(XPStatusPopup, {
        xpLevel: this.xp_level.number,
        xpValue: this.xp_value,
        xpMax: this.xp_level.xp_max,
      });
    });

    this.on('new_items', (e: unknown, data: unknown) => {
      _stopPropFile(e);
      this.makeNotifications(data as MakeNotificationsPayload);
    });
  }

  /** Game-load orchestration.  Hydrates the typeRegistry from the
   *  bootstrap payload, constructs the four view tabs (Imperium,
   *  Database, Missions, Topscores), recreates the perp tree from
   *  `data.nodes`, kicks the AP/Ani tickers, and wires up the
   *  ResizeObserver-driven `fitToWindow` flow. */
  loadGame(data: LoadGameData): GameRoot {
    // Clear if there are instances in the singleton.
    clearRegistry();
    if (_apTicker) this.APTicker = _apTicker;

    // Register all types (applies to all game_types).
    Object.entries(data.type_registry ?? {}).forEach(([k, v]) => {
      this.addType(k, v as TypeEntry);
    });

    // Register dummy gestalt of GameRoot (needed for type_settings):
    this.addType('GameRoot', { game_type: 'GameRoot', type_data: data.type_data ?? {} });
    this.addType('ProfileSet', { game_type: 'ProfileSet', type_data: {} });

    // Basic config of the GameRoot.
    const config: GameNodeConfig = {
      data: mergeData(
        this.getTypeData('GameRoot'),
        data as Parameters<typeof mergeData>[1]
      ) as Record<string, unknown>,
      gameType: 'GameRoot',
    };
    if (data._id !== undefined) config.id = data._id;
    if (data.user !== undefined) (config as { userdata?: unknown }).userdata = data.user;
    (config as { raw_data?: unknown }).raw_data = data;
    this.init(config);

    // Seed display_name from webxdc.selfName on first boot; persisted
    // as a delta so the name survives reloads without prompting the
    // user again.  The helper is non-mutating — we route the new
    // name through setDisplayName so the reducer produces a fresh
    // state instead of corrupting the live reference.
    const userPayload = (
      this.data as { user?: Parameters<typeof webxdcIdentity.getMessengerDisplayNameChange>[0] }
    ).user;
    const newSelfName = webxdcIdentity.getMessengerDisplayNameChange(userPayload);
    const remote = appModule.getApplication().remote as {
      setDisplayName?(name: string): unknown;
    };
    if (newSelfName) remote.setDisplayName?.(newSelfName);

    this.initGameValues();
    this.makeRenderConfig();

    // Make Main Tabs.  Imperium and Database are GameNode subclasses
    // imported above; we need the typed constructors here.
    const viewCtors = { Imperium, Database } as const;
    (Object.keys(viewCtors) as (keyof typeof viewCtors)[]).forEach((v) => {
      const tab = data[v];
      this.addType(v, {
        game_type: v,
        type_data: (tab?.type_data ?? {}) as Record<string, unknown>,
      });
      const Ctor = viewCtors[v];
      const viewmap = new Ctor({
        ...(tab?.game_id !== undefined ? { id: tab.game_id } : {}),
        ...(tab?.full_path !== undefined ? { path: tab.full_path } : {}),
        data: mergeData(
          this.getTypeData(v),
          tab?.instance_data as Parameters<typeof mergeData>[1]
        ) as Record<string, unknown>,
        renderNodeParent: this.id,
        gameType: v,
      } as GameNodeConfig);
      // Dual-keyed assignment matches legacy API surface (e.g.
      // `groot.Imperium`, `groot.Database` direct reads from
      // various callers that predate the typed accessors).
      (this as unknown as Record<string, unknown>)[v] = viewmap;
      this.addChild(viewmap);
    });

    // Make Missions Tab.
    this.addType('Missions', { game_type: 'Missions', type_data: {} });
    const missionsView = new Missions({
      id: 'Missions',
      data: this.getTypeData('Missions') ?? {},
      renderNodeParent: this.id,
      gameType: 'Missions',
    });
    this.Missions = missionsView;
    this.addChild(missionsView);

    // Make Topscores Tab.
    this.addType('Topscores', { game_type: 'Topscores', type_data: {} });
    this.addType('Topscore', { game_type: 'Topscore', type_data: {} });

    const topscoresView = new Topscores({
      id: 'Topscores',
      data: this.getTypeData('Topscores') ?? {},
      renderNodeParent: this.id,
      gameType: 'Topscores',
    }) as Topscores & {
      data: { type_titles?: Record<string, unknown> };
      initTopscore?(type: string): void;
    };
    this.Topscores = topscoresView;
    this.addChild(topscoresView);
    Object.keys(topscoresView.data?.type_titles ?? {}).forEach((type) => {
      topscoresView.initTopscore?.(type);
    });

    // Fill DBTokens lookup table.
    (data.nodes ?? [])
      .filter((t) => t.game_type === 'TokenPerp')
      .forEach((t) => {
        if (t.gestalt && t.instance_data?.amount !== undefined) {
          this.DBTokens[t.gestalt] = t.instance_data.amount;
        }
      });

    this.getDBTokensLength();
    this.getDBTokensLengthMax();

    // Create Imperium and Database GameNode tree structure without
    // recursion: walk a path-sorted snapshot, attach each node to its
    // parent (which the path-sort guarantees has been built first).
    const sortnodes = (data.nodes ?? [])
      .slice()
      .filter((n) => !n.gestalt || n.gestalt.substring(0, 6) !== 'origin')
      .sort((a, b) => (a.full_path ?? '').localeCompare(b.full_path ?? ''));

    sortnodes.forEach((datanode) => {
      const parentGameNode = getParentFromPath(datanode.full_path ?? '');
      if (!parentGameNode) return;
      // get gestalt from full_type if not available:
      if (!datanode.gestalt && datanode.full_type) {
        const g = getGestalt(datanode.full_type);
        if (g) datanode.gestalt = g;
      }
      // register dummy type when node not in typeRegistry:
      if (!this.getType(datanode.gestalt)) {
        const entry: TypeEntry = {};
        if (datanode.game_type !== undefined) entry.game_type = datanode.game_type;
        if (datanode.type_data !== undefined) entry.type_data = datanode.type_data;
        this.addType(datanode.gestalt ?? '', entry);
      }
      const type_data = this.getTypeData(datanode.gestalt);
      const node_data = mergeData(
        type_data,
        datanode.instance_data as Parameters<typeof mergeData>[1]
      ) as Record<string, unknown>;
      const Ctor = perpCtors[datanode.game_type ?? ''];
      if (!Ctor) return;
      const perp = new Ctor({
        id: datanode.game_id,
        gestalt: getGestalt(datanode.full_type ?? ''),
        path: datanode.full_path,
        data: node_data,
        // Render perps to first item in path (Imperium or Database)
        renderNodeParent: getFirstId(datanode.full_path ?? ''),
        ViewMap: getByFirstId(datanode.full_path ?? ''),
        parentNode: parentGameNode,
        gameType: datanode.game_type,
      } as unknown as GameNodeConfig);
      parentGameNode.addChild(perp);
    });

    (data.nodes_charging ?? []).forEach((v) => {
      const gnode = getByLastId(v.path) as
        | (GameNode & {
            data?: { charge_time?: number };
            setAttrs?(attrs: Record<string, unknown>): void;
          })
        | undefined;
      if (!gnode) return;
      const timerconf = {
        serverTime: data.server_time?.$date,
        duration: gnode.data?.charge_time,
        // chargeEntry.charge_start is a plain epoch-ms number — no
        // $date wrapper.
        serverStart: v.charge_start,
      };
      gnode.setAttrs?.({ _loadTimer: timerconf });
    });

    (data.nodes_collect ?? []).forEach((v) => {
      const gnode = getByLastId(v.path) as
        | (GameNode & { setAttrs?(attrs: Record<string, unknown>): void })
        | undefined;
      gnode?.setAttrs?.({ _loadReady: true });
    });

    // register Missions...
    (
      this.Missions as (Missions & { initMissions?(d: LoadGameData): void }) | undefined
    )?.initMissions?.(data);

    (data.db_queue ?? []).forEach((v) => {
      const db = this.getDatabase() as
        | (Database & { cue?(ps: unknown, origin: unknown, collect_id: unknown): void })
        | undefined;
      db?.cue?.(v.profile_set, v.origin, v.collect_id);
    });

    // register Karmalizers and Karmalauters...
    Object.values(data.karmalauters ?? {}).forEach((p) => {
      const g = (p?.type_data as { gestalt?: string } | undefined)?.gestalt;
      if (g) this.addType(g, p);
    });
    Object.values(data.karmalizers ?? {}).forEach((p) => {
      const g = (p?.type_data as { gestalt?: string } | undefined)?.gestalt;
      if (g) this.addType(g, p);
    });

    // compile origin tokens for Database
    this.compileOriginTokens(data.nodes ?? []);

    this.on('after_render', () => {
      (this.renderNode as { show?(): void } | undefined)?.show?.();
      _aniTicker?.start();
    });
    this.on('before_render', () => {
      (this.renderNode as { hide?(): void } | undefined)?.hide?.();
    });

    // On first game start with no explicit locale choice, auto-detect
    // from the browser locale.  German variants (de, de-DE, de-AT,
    // de-CH, …) default to DE; everything else defaults to EN.
    // setLocale persists the choice so this branch is skipped on
    // every subsequent load.
    if (data.is_new_game && !data.locale_persisted) {
      const chosen = /^de\b/i.test(navigator.language ?? '') ? 'de' : 'en';
      const remote = appModule.getApplication().remote as {
        setLocale?(locale: string): { done(cb: () => void): unknown };
      };
      remote.setLocale?.(chosen).done(() => location.reload());
      return this;
    }

    this.render();

    // fitToWindow handles centring; the legacy `is_new_game`
    // `scrollTo` would be immediately overwritten so we no longer
    // set it here.
    this.fitToWindow();
    const $ = globalThis.$;
    if ($) {
      $(window).off?.('resize.gameFit');
      $(window).on?.(
        'resize.gameFit',
        debounce(() => {
          this.fitToWindow();
        }, 100)
      );
    }
    // The mobile MainMenu grows after the XP bar gets cloned in and
    // on CSS-driven reflows (orientation, font load); refit the
    // Stage whenever the header's measured height changes so we
    // don't push the playfield past the bottom of the viewport.
    const menuDom = (this.renderMenu as { domelem?: unknown } | undefined)?.domelem;
    const RO = (
      globalThis as unknown as {
        ResizeObserver?: new (cb: () => void) => { observe(t: unknown): void };
      }
    ).ResizeObserver;
    if (menuDom && typeof RO === 'function') {
      const refit = debounce(() => {
        this.fitToWindow();
      }, 50);
      new RO(refit).observe(menuDom);
    }

    return this;
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
