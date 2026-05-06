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

/** Minimal Render surface needed by the lifecycle methods extracted in
 *  this PR.  Collapses when Render.js is typed (later in #147). */
interface RenderRootLike {
  lock?(): void;
  unlock?(): void;
  jdomelem?: { find(sel: string): { off(ev?: string): void } };
}

interface AniTickerLike {
  start(): void;
  stop(): void;
}

let _aniTicker: AniTickerLike | null = null;
/** Game.js injects the AniTicker singleton at IIFE-end via this setter
 *  (parallel to `setAniTicker` on GamePerp).  Disposable seam — retires
 *  when AniTicker itself extracts. */
export function setAniTickerForGameRoot(ticker: AniTickerLike): void {
  _aniTicker = ticker;
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
  cash_value = 0;
  ap_value = 0;
  karma_value = 0;
  xp_level: { number: number; [key: string]: unknown } = { number: 0 };
  data: { status_icons?: unknown; [key: string]: unknown } = {};
  override renderNode?: NonNullable<GameNode['renderNode']> & RenderRootLike;
  // `renderMenu` widens GameNode's typed declaration to also expose the
  // RenderRoot lock/unlock surface the lifecycle methods touch.
  override renderMenu?: NonNullable<GameNode['renderMenu']> &
    RenderRootLike & {
      addButton?(label: string, id: string, states: unknown): void;
    };
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
