// Database — the player's collected-tokens view.  Holds the DB queue
// (pending profilesets to integrate) and the integrated TokenPerps.
// Extracted from scripts/Game.js's IIFE in PR 10 of issue #147.
//
// The dynamic `Game[node.game_type]` lookup is resolved via
// `perpCtors[name]` (typed direct map, PR 17 of issue #147); the
// known-name `Game.TokenPerp` reference uses a direct import.

import { type RenderApi, getRender } from '../Render.js';
import appModule from '../app.js';
import { toKSNum } from '../dd-helpers.js';
import i18n from '../i18n.js';
import {
  GameNode,
  type GameNodeConfig,
  getByFirstId,
  getByGestalt,
  getById,
  getByLastId,
  getByType,
  getFirstId,
} from './GameNode.js';
import { type DoneFailChain, type RenderPopupLike } from './GamePerp.js';
import { type GameRoot } from './GameRoot.js';
import { OrderedSet } from './OrderedSet.js';
import { ProfileSet } from './ProfileSet.js';
import { TokenPerp } from './TokenPerp.js';
import { mergeData } from './mergeData.js';
import { perpCtors } from './perpCtors.js';

// ---------------------------------------------------------------------------
// Local types
// ---------------------------------------------------------------------------

// RenderMenuLike — replaced with a Pick of the actual MainMenu instance
// type to retire the structural triplicate that lived here, in
// Imperium.ts, Missions.ts, and Topscores.ts.
type RenderMenuLike = Pick<InstanceType<RenderApi['MainMenu']>, 'addButton'>;

interface RenderNodeLike {
  addChild?(node: unknown, ...args: unknown[]): void;
  addPopup?(node: unknown): void;
  lock?(): void;
  unlock?(): void;
  getPosition?(): { x: number; y: number };
  hide?(): void;
  parentNode?: { scrollTo?(pos: { x: number; y: number }): void };
  width?: number;
  height?: number;
  jdomelem?: {
    find?(sel: string): { addClass?(c: string): void; removeClass?(c: string): void };
    addClass?(c: string): void;
    removeClass?(c: string): void;
  };
  FXNoCash?(): void;
  FXNoAP?(): void;
  FXMerge?(psid: string, increment: number, dup: number, wait: number): void;
  FXArise?(cb?: () => void): void;
  FXBounce?(): void;
  FXWheee?(opts: { psid: string; isnew: boolean; text: string }): void;
  addDecorator?(deco: unknown): void;
  setAttrs?(attrs: unknown): void;
  draw?(): void;
  render?(): void;
  trigger(ev: string, args?: unknown[]): void;
}

// RenderPopupLike — re-imported from GamePerp.ts (canonical definition).
// Was triplicated across Database / GameRoot / GameNode prior to this PR.

/** Type entry as returned by GameRoot.getType — narrow shape Database
 *  pushes into ProvidedPerp.data.requiredTokens.  Game.js's typeRegistry
 *  is loose; tighten when GameRoot is extracted with a typed surface. */
type TypeEntry = {
  type_data?: Record<string, unknown>;
  game_type?: string;
  [key: string]: unknown;
};

interface ProvidedPerp {
  gestalt: string;
  data: Record<string, unknown> & {
    requiredTokens?: TypeEntry[];
    required_level?: number;
    contained_tokens?: ContainedToken[];
  };
  locked: boolean;
}

interface ContainedToken {
  gestalt: string;
  is_required?: boolean;
  amount?: number;
  [key: string]: unknown;
}

interface DatabaseInstanceData {
  providedPerps?: ProvidedPerp[];
  buyToken_xp_level_min?: number;
  [key: string]: unknown;
}

/** TokenPerp-like instance shape used during the merge flow.  `setAmount`
 *  / `updateRenderAmount` / `updateGear` are only called on real
 *  TokenPerp instances; declared loosely here to avoid a cross-import
 *  before TokenPerp itself is extracted in PR 11+. */
interface TokenPerpLike extends GameNode {
  setAmount?(amount: number): void;
  updateRenderAmount?(): void;
  updateGear?(): void;
  data: { absoluteInc?: number; [key: string]: unknown };
  path?: string;
}

interface IntegrateResult {
  game_values?: { profiles_value?: number; [key: string]: unknown };
  levelup?: boolean;
  missions?: unknown;
  result?: {
    increment?: number;
    dup?: number;
    nodes?: Array<{
      game_id?: string;
      gestalt?: string;
      game_type?: string;
      full_path?: string;
      instance_data?: { amount?: number; [key: string]: unknown };
    }>;
  };
  error?: number;
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

// ---------------------------------------------------------------------------
// Database class
// ---------------------------------------------------------------------------

export class Database extends GameNode {
  override renderType = 'ViewMap';
  declare data: DatabaseInstanceData;
  ViewMap?: Database;
  queue: OrderedSet<ProfileSet>;
  renderDBQueue?: RenderNodeLike & { gameNode?: Database; render(): void };
  override renderPopup?: RenderPopupLike;
  popupTemplateData?: Record<string, unknown>;
  path?: string;

  constructor(config?: GameNodeConfig) {
    super(config);
    this.ViewMap = this;
    this.queue = new OrderedSet<ProfileSet>();
  }

  // ---------------------------------------------------------------------
  // Typed accessors — `groot` is a thin alias for `this.GameRoot` (typed
  // as the real `GameRoot` class on `GameNode`); kept to avoid churning
  // the many call sites that read `groot.foo`.  The Render-module
  // forward-ref cast still lives in `getRenderModule` until Render.js
  // is typed.
  // ---------------------------------------------------------------------

  private get groot(): GameRoot {
    return this.GameRoot;
  }

  private get renderApi(): RenderNodeLike | undefined {
    return this.renderNode as RenderNodeLike | undefined;
  }

  private getRenderModule(): Pick<RenderApi, 'Popup' | 'DBQueue' | 'DecoratorNew' | 'getById'> {
    return getRender();
  }

  compileSuperTokens(): void {
    const groot = this.groot;
    // FIXME create buyable supertokens for DB
    this.data.providedPerps = [];
    this.data.buyToken_xp_level_min = 99999;
    const buyable = Object.values(groot.typeRegistry).filter((v) => {
      const td = v.type_data as
        | { is_buyable?: boolean; required_level?: number; [key: string]: unknown }
        | undefined;
      if (td?.is_buyable) {
        const required = (td.required_level as number | undefined) ?? 99999;
        const current = this.data.buyToken_xp_level_min ?? 99999;
        this.data.buyToken_xp_level_min = required < current ? required : current;
      }
      return (
        td?.is_buyable &&
        v.gestalt !== undefined &&
        !Object.prototype.hasOwnProperty.call(groot.DBTokens, v.gestalt)
      );
    });
    buyable.forEach((t) => {
      const provided: ProvidedPerp = {
        gestalt: t.gestalt ?? '',
        data: mergeData({}, groot.getTypeData(t.gestalt)) as ProvidedPerp['data'],
        locked: false,
      };
      provided.data.requiredTokens = [];
      const contained: ContainedToken[] =
        (provided.data.contained_tokens as ContainedToken[]) || [];
      contained.forEach((v) => {
        if (v.is_required === true) {
          const subtype = groot.getType(v.gestalt);
          if (subtype) provided.data.requiredTokens?.push(subtype);
          // check if all required tokens are there, else set to locked
          if (!Object.prototype.hasOwnProperty.call(groot.DBTokens, v.gestalt)) {
            provided.locked = true;
          } else if (groot.DBTokens[v.gestalt] === 0) {
            provided.locked = true;
          }
        }
      });
      const reqLvl = provided.data.required_level ?? 0;
      if (reqLvl > groot.xp_level.number) {
        provided.locked = true;
      }
      (this.data.providedPerps as ProvidedPerp[]).push(provided);
    });
    const sorted = (this.data.providedPerps as ProvidedPerp[]).slice().sort((a, b) => {
      const ra = a.data.required_level ?? 0;
      const rb = b.data.required_level ?? 0;
      return ra - rb;
    });
    // groupBy(locked) then flatten — unlocked first, locked after.
    const unlocked = sorted.filter((v) => !v.locked);
    const locked = sorted.filter((v) => v.locked);
    this.data.providedPerps = unlocked.concat(locked);
  }

  openUpgradesPopup(): unknown {
    const Render = this.getRenderModule();
    const groot = this.groot;
    // Popup instantiated for the first time
    if (!this.popupTemplateData) {
      this.popupTemplateData = {};
      this.popupTemplateData.status_icons = groot.data.status_icons;
      this.popupTemplateData.states = {};
      this.popupTemplateData.data = this.data;
      const pdata = this.data as Record<string, unknown>;
      pdata.gestalt = 'Database';
      pdata.id = this.id;
      pdata.title = i18n.gettext('database_buytokens title');
      pdata.subtitle = i18n.gettext('database_buytokens subtitle');
      pdata.description = i18n.gettext('database_buytokens description');
      pdata.selectortitle = i18n.gettext('database_buytokens selector title');
      pdata.mainsprites_class = 'DBUpgrade';
      this.popupTemplateData.groot = groot;
    }
    this.popupTemplateData.data = this.data;

    const popupConfig = {
      gameNode: this,
      template: 'popup.html',
      templateData: this.popupTemplateData,
      popupContainer: this,
    };

    const popup = new Render.Popup(
      popupConfig as unknown as ConstructorParameters<RenderApi['Popup']>[0]
    ) as unknown as RenderPopupLike;
    this.renderPopup = popup;
    this.renderApi?.addPopup?.(popup);

    // initPopupEvents lives on GameNode.prototype (added by Game.js's
    // legacy mixin block).  Type loosely until that mixin is consolidated.
    if (this.initPopupEvents) this.initPopupEvents();

    return popup;
  }

  BuyPerp(bgestalt: string, placePos?: { x: number; y: number }): void {
    this.BuyToken(bgestalt, placePos);
  }

  BuyToken(bgestalt: string, placePos?: { x: number; y: number }): void {
    // Buy Supertokens
    const gnode = this;
    const groot = this.groot;
    const remote = appModule.getApplication().remote;
    const buyPerpFn = remote.buyPerp;
    if (!buyPerpFn) return;
    const Render = this.getRenderModule();
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
        // Probably no cash
        if (gnode.renderPopup && gnode.renderPopup.open) {
          gnode.renderPopup.trigger('no_cash');
        } else {
          (gnode.renderNode as RenderNodeLike | undefined)?.FXNoCash?.();
        }
        return;
      }
      if (gnode.renderPopup) {
        gnode.renderPopup.trigger('popup_close');
      }
      if (r.node) {
        groot.updateGameValues(r.game_values || {}, r.levelup === true, r.missions);
        const node = r.node;
        const nodeGameType = node.game_type;
        if (!nodeGameType) return;
        const Ctor = perpCtors[nodeGameType];
        if (!Ctor) return;
        const node_data = groot.getTypeData(bgestalt);
        const perp = new Ctor({
          id: node.game_id,
          gestalt: bgestalt,
          path: node.full_path,
          noConnect: true,
          data: mergeData(node_data, node.instance_data),
          // Render perps to first item in path (Imperium or Database)
          renderNodeParent: getFirstId('Database'),
          ViewMap: getByFirstId('Database'),
          gameType: nodeGameType,
        }) as GameNode & {
          data: { contained_tokens: ContainedToken[]; [key: string]: unknown };
          renderData: { config: { placeRandom?: { x: number; y: number }; hidden?: boolean } };
          path?: string;
        };
        gnode.addChild(perp);

        const viewMapNode = getByFirstId('Database')?.renderNode as RenderNodeLike | undefined;
        let resolvedPos: { x: number; y: number } = placePos || {
          x: (viewMapNode?.width ?? 0) / 2,
          y: (viewMapNode?.height ?? 0) / 2,
        };
        if (perp.data.contained_tokens && perp.data.contained_tokens.length) {
          const firstContained = perp.data.contained_tokens.find((t) => t.is_required);
          if (firstContained && firstContained.gestalt) {
            const placeNear = getByGestalt(firstContained.gestalt);
            const pn = placeNear?.renderNode as RenderNodeLike | undefined;
            const pos = pn?.getPosition?.();
            if (pos) resolvedPos = pos;
          }
        }
        perp.renderData.config.placeRandom = resolvedPos;
        perp.renderData.config.hidden = true;

        perp.render();
        const prn = perp.renderNode as RenderNodeLike | undefined;
        prn?.addDecorator?.(
          new Render.DecoratorNew({ text: i18n.gettext('New!'), extendClass: 'NewPerp' })
        );
        prn?.hide?.();
        const pos = prn?.getPosition?.();
        if (pos) prn?.parentNode?.scrollTo?.(pos);
        if (perp.path && pos) {
          groot.trigger('saveCoords', [perp.path, pos]);
        }
        window.setTimeout(function () {
          prn?.FXArise?.(function () {
            prn?.FXBounce?.();
          });
        }, 300);
        // save coords to backend
      }
    });
  }

  override extendRender(): void {
    const groot = this.groot;
    const Render = this.getRenderModule();
    // FIXME: name should be in data
    groot.renderMenu?.addButton?.(i18n.gettext('Database'), this.id, this.states);
    this.compileSuperTokens();
    this.renderDBQueue = new Render.DBQueue({
      data: this.data,
      queue: this.queue,
    } as unknown as ConstructorParameters<RenderApi['DBQueue']>[0]) as unknown as NonNullable<
      Database['renderDBQueue']
    >;
    this.renderDBQueue.gameNode = this;
    this.renderApi?.addChild?.(this.renderDBQueue, true);
  }

  lock(): void {
    // TODO: Lock Profileset Queue etc...
    this.renderApi?.lock?.();
  }

  unlock(): void {
    // TODO: Unlock Profileset Queue etc...
    this.renderApi?.unlock?.();
  }

  cue(profileset: unknown, path: unknown, collect_id: unknown): ProfileSet {
    // Add a ProfileSet to the DB queue.  Inputs come from server payloads
    // (mission rewards, perp collect results) so the typed surface is
    // intentionally permissive; we narrow what we actually read below.
    const origin = typeof path === 'string' ? getByLastId(path) : undefined;
    const cfg: ConstructorParameters<typeof ProfileSet>[0] = {
      markNew: true,
      sortByGestalt: true,
    };
    if (typeof collect_id === 'string') cfg.psid = collect_id;
    if (origin) cfg.origin = origin;
    const profiles_value = (profileset as { profiles_value?: unknown } | null | undefined)
      ?.profiles_value;
    if (typeof profiles_value === 'number') cfg.profiles_value = profiles_value;
    const ps = new ProfileSet(cfg, profileset as ConstructorParameters<typeof ProfileSet>[1]);
    this.queue.prepend(ps);
    if (this.renderDBQueue) {
      this.renderDBQueue.render();
    }
    return ps;
  }

  getToken(gestalt: string): TokenPerpLike | undefined {
    const found = this.children.set.find((c) => c.gestalt === gestalt);
    return found as TokenPerpLike | undefined;
  }

  getCued(psid: string): ProfileSet | undefined {
    return this.queue.set.find((q) => q.psid === psid);
  }

  mergeCued(psid: string): void {
    // Do the merging/integrate stuff.
    const gnode = this;
    const groot = this.groot;
    const ps = this.getCued(psid);
    if (!ps) return;
    const update_tokens: TokenPerpLike[] = [];
    const new_tokens: TokenPerpLike[] = [];

    // TODO: backend api call goes here, check for AP and give feedback in renderer.
    if (groot.ap_value < 1) {
      if (gnode.renderPopup && gnode.renderPopup.open) {
        gnode.renderPopup.trigger('no_AP');
      } else {
        (
          gnode.renderDBQueue?.jdomelem?.find?.('.selected') as
            | { removeClass?(c: string): void }
            | undefined
        )?.removeClass?.('selected');
        gnode.renderDBQueue?.FXNoAP?.();
      }
      return;
    }

    const remote = appModule.getApplication().remote;
    const integrateFn = remote.integrateCollected;
    if (!integrateFn) return;
    const Render = this.getRenderModule();

    const call = integrateFn(psid) as unknown as DoneFailChain<IntegrateResult>;
    call.done(function (data) {
      if (!data.result) {
        gnode.Error?.('The computer says NOOOO', data);
        return;
      }
      const r = data.result;
      // FIXME returned error 0
      if (r.error !== undefined) {
        // No AP
        if (gnode.renderPopup && gnode.renderPopup.open) {
          gnode.renderPopup.trigger('no_AP');
        } else {
          (
            gnode.renderDBQueue?.jdomelem?.find?.('.selected') as
              | { removeClass?(c: string): void }
              | undefined
          )?.removeClass?.('selected');
          gnode.renderDBQueue?.FXNoAP?.();
        }
        return;
      }
      if (gnode.renderPopup) {
        gnode.renderPopup.trigger('popup_close');
      }
      const gv = r.game_values || {};
      groot.setProfiles(gv.profiles_value, true);
      // Recompute game values + mission goals so integrate_profiles missions
      // tick over right after DBTokensAbsolute is populated.  setProfiles
      // above already set profiles_value, so the inner setProfiles in
      // updateGameValues is a no-op (guard by !== current).
      groot.updateGameValues(gv, r.levelup === true, r.missions, true);
      const profiles_increment = r.result?.increment ?? 0;
      const profiles_dup = r.result?.dup ?? 0;

      // FIXME: compile for checkNotifications
      gnode.checkNotifications();

      // exclude origin tokens
      const all_tokens = (r.result?.nodes || []).filter((n) => {
        if (n.gestalt) return n.gestalt.substring(0, 6) !== 'origin';
        return false;
      });

      // compile origin tokens
      groot.compileOriginTokens(r.result?.nodes || []);

      // update all token amounts and renderNode if they already exist
      all_tokens.forEach((t) => {
        if (!t.game_id) return;
        const ti = getById(t.game_id) as TokenPerpLike | undefined;
        if (ti) {
          if (typeof t.instance_data?.amount === 'number') {
            ti.setAmount?.(t.instance_data.amount);
          }
          const tir = Render.getById(t.game_id);
          if (tir && t.gestalt && !Object.prototype.hasOwnProperty.call(ps.tokens_map, t.gestalt)) {
            ti.updateRenderAmount?.();
          }
        }
      });

      const triggerQueue: GameNode[] = [];
      // Precompute gestalt-keyed lookup maps so the inner loop is O(M)
      // instead of O(M*N) — a profileset with M tokens against a Database
      // with N children would otherwise scan children.set + all_tokens
      // linearly per token.
      const childrenByGestalt = new Map<string, TokenPerpLike>();
      for (const c of gnode.children.set) {
        if (c.gestalt) childrenByGestalt.set(c.gestalt, c as TokenPerpLike);
      }
      const allTokensByGestalt = new Map<string, (typeof all_tokens)[number]>();
      for (const n of all_tokens) {
        if (n.gestalt) allTokensByGestalt.set(n.gestalt, n);
      }
      Object.keys(ps.tokens_map).forEach((gestalt) => {
        const token = childrenByGestalt.get(gestalt);
        if (token) {
          // collect update tokens
          update_tokens.push(token);
        } else {
          // create new tokens
          const type = groot.getType(gestalt);
          if (type && type.game_type === 'TokenPerp') {
            const token_instance = allTokensByGestalt.get(gestalt);
            if (token_instance) {
              const newToken = new TokenPerp({
                id: token_instance.game_id,
                gestalt: gestalt,
                path: token_instance.full_path,
                data: mergeData(type.type_data, token_instance.instance_data || {}),
                renderNodeParent: getFirstId('Database'),
                ViewMap: getByFirstId('Database'),
                gameType: type.game_type,
              } as ConstructorParameters<typeof TokenPerp>[0]) as TokenPerpLike;
              gnode.addChild(newToken);
              triggerQueue.push(newToken);
              new_tokens.push(newToken);
            }
          }
        }
      });

      let delay = 250;
      let wait = 0;
      update_tokens.forEach((t) => {
        wait = wait + delay;
        const text = '+' + toKSNum((t.data.absoluteInc as number) || 0);
        window.setTimeout(function () {
          if (t.renderNode) {
            (t.renderNode as RenderNodeLike).FXWheee?.({ psid: psid, isnew: false, text: text });
          }
        }, wait);
      });
      delay = 250;
      if (new_tokens.length) {
        wait = 0;
      }
      new_tokens.forEach((t) => {
        wait = wait + delay;
        const text = '+' + toKSNum((t.data.absoluteInc as number) || 0);
        window.setTimeout(function () {
          t.render();
          const trn = t.renderNode as RenderNodeLike | undefined;
          trn?.addDecorator?.(
            new Render.DecoratorNew({ text: i18n.gettext('New!'), extendClass: 'NewToken' })
          );
          trn?.hide?.();
          trn?.FXWheee?.({ psid: psid, isnew: true, text: text });
          // save coords to backend
          const pos = trn?.getPosition?.();
          if (t.path && pos) {
            groot.trigger('saveCoordsQueue', [t.path, pos]);
          }
        }, wait);
      });

      gnode.renderDBQueue?.FXMerge?.(psid, profiles_increment, profiles_dup, wait);

      // finally remove the ProfileSet GameNode
      gnode.queue.remove(ps);
      ps.remove();
      groot.updateGameValues(gv, r.levelup === true, r.missions);
      groot.setProfiles();
      window.setTimeout(function () {
        triggerQueue.forEach((t) => {
          t.trigger('after_create');
        });
        gnode.checkNotifications();
        groot.updateGears?.();
      }, 500 + wait);
    });
  }

  checkNotifications(): void {
    const groot = this.groot;
    if (!this.data.providedPerps) {
      this.compileSuperTokens();
      return;
    }
    const before = this.data.providedPerps.filter((p) => !p.locked).map((p) => p.gestalt);
    this.compileSuperTokens();
    const after = (this.data.providedPerps || []).filter((p) => !p.locked).map((p) => p.gestalt);
    const newbuyable = after.filter((g) => !before.includes(g));
    if (newbuyable.length) {
      groot.makeNotifications({ perps: newbuyable });
      const db = groot.getDatabase();
      db?.renderDBQueue?.render?.();
      db?.renderDBQueue?.jdomelem?.addClass?.('NewBuyable');
    }
  }

  openProfileSetPopup(ps: ProfileSet): unknown {
    const gnode = this;
    const groot = this.groot;
    const Render = this.getRenderModule();
    const origin = ps.origin;
    if (!origin) return undefined;
    ps.updateNewMarker();
    // Popup instantiated for the first time
    if (!ps.popupTemplateData) {
      ps.popupTemplateData = {};
      const ptd = ps.popupTemplateData;
      ptd.ProfileSet = ps;
      ptd.states = origin.states;
      ptd.status_icons = groot.data.status_icons;
      const pd: Record<string, unknown> = {};
      if (origin.gestalt) pd.gestalt = origin.gestalt;
      if (origin.id) pd.id = origin.id;
      ptd.data = pd;
    }

    // Update data with current gnode data
    Object.assign(ps.popupTemplateData.data as Record<string, unknown>, origin.data || {});

    const popupConfig = {
      gameNode: this,
      template: 'popup_profileset.html',
      templateData: ps.popupTemplateData,
      popupContainer: this,
    };

    const popup = new Render.Popup(
      popupConfig as unknown as ConstructorParameters<RenderApi['Popup']>[0]
    ) as unknown as RenderPopupLike;
    this.renderPopup = popup;
    (gnode.renderNode as RenderNodeLike | undefined)?.addPopup?.(popup);

    popup.on('button_click.MainButton', function (e: unknown) {
      if (e && typeof (e as { stopPropagation?: () => void }).stopPropagation === 'function') {
        (e as { stopPropagation: () => void }).stopPropagation();
      }
      if (ps.psid) gnode.mergeCued(ps.psid);
    });

    popup.on('popup_close', function (e: unknown) {
      if (e && typeof (e as { stopPropagation?: () => void }).stopPropagation === 'function') {
        (e as { stopPropagation: () => void }).stopPropagation();
      }
      popup.close();
      delete gnode.renderPopup;
    });

    return popup;
  }

  override initEventHandlers(): void {
    // Override the GameNode default to add Database-specific listeners on
    // top of the legacy `vclick → stopPropagation` baseline.
    super.initEventHandlers();
    const gnode = this;

    // FIXME MAKE POPUP for supertoken purchases.
    gnode.on('select_upgrades', function () {
      gnode.renderDBQueue?.jdomelem?.removeClass?.('NewBuyable');
      gnode.compileSuperTokens();
      gnode.openUpgradesPopup();
    });

    gnode.on('profileset_click', function (_e: unknown, psid: unknown) {
      if (typeof psid !== 'string') return;
      const ps = gnode.getCued(psid);
      if (ps) gnode.openProfileSetPopup(ps);
    });
    gnode.on('profileset_shift_click', function (e: unknown, psid: unknown) {
      if (e && typeof (e as { stopPropagation?: () => void }).stopPropagation === 'function') {
        (e as { stopPropagation: () => void }).stopPropagation();
      }
      if (typeof psid !== 'string') return;
      const ps = gnode.getCued(psid);
      if (ps && ps.psid) gnode.mergeCued(ps.psid);
    });
    gnode.on('popup_cancel', function () {
      (
        gnode.renderDBQueue?.jdomelem?.find?.('.selected') as
          | { removeClass?(c: string): void }
          | undefined
      )?.removeClass?.('selected');
    });
  }
}

void getByType;
