// GameNode base class + instance registry, extracted from scripts/Game.js's
// IIFE in the issue #147 / Phase 7 migration.  Foundation for the
// per-subclass extractions to come (Topscores, Missions, Imperium, …) —
// each subclass extends GameNode via the legacy `extend(SubClass, GameNode)`
// helper from ./util.js.
//
// What's here:
//   - The instance registry (`_instances`, `_ids`) + add/get/remove/clear
//     helpers.  Mutated by GameNode.init() / GameNode.remove().
//   - The GameNode class itself.
//
// What's not here yet:
//   - GameRoot, GameNode subclasses, all the helper functions in Game.js
//     that read from the registry (getById, getByGestalt, …).  Those stay
//     in Game.js for now and read the registry through the imports below.
//
// Vendor globals (`$`, `sprintf`) come from types/env.d.ts.  `Render` and
// `typeSettings` are pulled lazily inside the methods that need them so we
// don't crash on module load if those modules haven't initialised yet.

import type { JQueryLike, JQueryStatic } from '../../types/env.d.ts';
import { type RenderApi, getRender } from '../Render.js';
import appModule from '../app.js';
import setup from '../setup.js';
import { getTypeSettings } from '../type_settings.js';
import type { GameRoot } from './GameRoot.js';
import { OrderedSet } from './OrderedSet.js';
import { mergeData } from './mergeData.js';

// Typed dynamic constructor pick — replaces the loose
// `(Render as Record<string, unknown>)[renderType]` lookup that used to
// live in `render()`.  Constraining the key to `keyof RenderApi` makes
// the lookup typed at the call site (`pickRenderCtor('Node')` → typeof
// RenderNode etc.); callers that need to fall through to `undefined`
// when `renderType` is empty / off-API check before calling.
function pickRenderCtor<K extends keyof RenderApi>(k: K): RenderApi[K] {
  return getRender()[k];
}

function _$(): JQueryStatic {
  const fn = jQuery ?? globalThis.$;
  if (!fn) throw new Error('GameNode: jQuery global not found');
  return fn;
}

// ---------------------------------------------------------------------------
// Instance registry
// ---------------------------------------------------------------------------
// Module-level state shared with Game.js's in-IIFE helpers.  The registry
// arrays are exported as live bindings — mutations here are visible to every
// importer.  Sparse-friendly: `_instances[k]` slots are explicitly cleared
// to `undefined` rather than spliced out, matching the legacy behaviour
// (`_instances[_id] = undefined`) so `_id` indices stay stable.

export const _instances: Array<GameNode | undefined> = [];
export const _ids: Record<string, GameNode> = {};

export function add(node: GameNode): void {
  _instances[node._id] = node;
  _ids[node.id] = node;
}

export function get(_id: number): GameNode | undefined {
  return _instances[_id];
}

export function remove(_id: number): void {
  const n = get(_id);
  if (n) {
    delete _ids[n.id];
  }
  _instances[_id] = undefined;
}

export function clear(): void {
  for (let n = 0; n < _instances.length; n++) {
    const node = _instances[n];
    if (node) {
      node.remove();
    }
  }
  _instances.length = 0;
}

// ---------------------------------------------------------------------------
// Id / path helpers
// ---------------------------------------------------------------------------
// Read-side helpers over the registry.  Game.js used to inline these in its
// IIFE; they live here now so subclass extractions (Topscores, Missions, …)
// can import them without a roundtrip through Game.js.

/** Returns the GameNode registered under `id` (the human-readable id, not _id). */
export function getById(id: string): GameNode | undefined {
  return _ids[id];
}

/** Returns the first segment of a Path (root id). */
export function getFirstId(path: string): string {
  const parts = path.split(setup.pathSeparator);
  return parts[0] ?? '';
}

/** Returns the last segment of a Path (usually the GameNode's own id). */
export function getLastId(path: string): string {
  const parts = path.split(setup.pathSeparator);
  return parts[parts.length - 1] ?? '';
}

/** Returns the second-last segment of a Path. */
export function getParentId(path: string): string {
  const parts = path.split(setup.pathSeparator);
  parts.pop();
  return parts.pop() ?? '';
}

/** Returns the GameNode at the root of a Path. */
export function getByFirstId(path: string): GameNode | undefined {
  return getById(getFirstId(path));
}

/** Returns the GameNode for the last segment of a Path. */
export function getByLastId(path: string): GameNode | undefined {
  return getById(getLastId(path));
}

/** Returns the parent GameNode of the node at the end of a Path. */
export function getParentFromPath(path: string): GameNode | undefined {
  return getById(getParentId(path));
}

/** Returns the gestalt segment of a `GameType:gestalt` full-type string. */
export function getGestalt(full_type: string): string | undefined {
  return full_type.split(setup.typeSeparator)[1];
}

// ---------------------------------------------------------------------------
// Gestalt / type queries
// ---------------------------------------------------------------------------
// These walk the full registry; O(n) per call — fine for the leaderboard /
// mission UI flows that already iterated `Game._ids`.

/** First GameNode whose `.gestalt === gestalt`. */
export function getByGestalt(gestalt: string): GameNode | undefined {
  for (const id in _ids) {
    if (Object.prototype.hasOwnProperty.call(_ids, id)) {
      const node = _ids[id];
      if (node && node.gestalt === gestalt) return node;
    }
  }
  return undefined;
}

/** All GameNodes whose `.gestalt === gestalt`. */
export function getAllByGestalt(gestalt: string): GameNode[] {
  const out: GameNode[] = [];
  for (const id in _ids) {
    if (Object.prototype.hasOwnProperty.call(_ids, id)) {
      const node = _ids[id];
      if (node && node.gestalt === gestalt) out.push(node);
    }
  }
  return out;
}

/** Run `func(node, id)` for every registered node whose `.gestalt === gestalt`. */
export function eachByGestalt(gestalt: string, func: (node: GameNode, id: string) => void): void {
  if (!func) return;
  for (const id in _ids) {
    if (Object.prototype.hasOwnProperty.call(_ids, id)) {
      const node = _ids[id];
      if (node && node.gestalt === gestalt) func(node, id);
    }
  }
}

/** All GameNodes whose `.gameType === game_type`. */
export function getByType(game_type: string): GameNode[] {
  const out: GameNode[] = [];
  for (const id in _ids) {
    if (Object.prototype.hasOwnProperty.call(_ids, id)) {
      const node = _ids[id];
      if (node && node.gameType === game_type) out.push(node);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

export interface GameNodeConfig {
  id?: string;
  gestalt?: string;
  gameType?: string;
  data?: Record<string, unknown>;
  states?: Record<string, boolean>;
  renderNodeParent?: unknown;
  ViewMap?: unknown;
  [key: string]: unknown;
}

interface RenderConfig {
  id?: string;
  name?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  label?: string;
  zoomScale?: number;
  perpSprite?: unknown;
  perpBackground?: Record<string, unknown> | null;
  background?: unknown;
  RenderTemplate?: unknown;
  no_render?: boolean;
  [key: string]: unknown;
}

interface RenderData {
  config?: RenderConfig;
  parentNode?: unknown;
  [key: string]: unknown;
}

interface RenderNodeLike {
  remove(): void;
  setAttrs?(attrs: RenderConfig): void;
  draw?(): void;
  trigger(ev: string, args?: unknown[]): void;
  hide?(): void;
  show?(): void;
  hidden?: boolean;
  jdomelem?: unknown;
  gameNode?: GameNode;
  addPopup?(popup: unknown): void;
  FXError?(): void;
  FXNoCash?(): void;
  FXNoAP?(): void;
  DecoratorNew?: { remove(): void };
  [key: string]: unknown;
}

// RenderPopupLike — was duplicated across GameNode / GameRoot / GamePerp
// / Database / ProjectPerp.  Now imports the canonical declaration from
// GamePerp.ts (a type-only import — no runtime cycle); the GameNode-side
// extras (notification-popup tagging, jdomelem delegation handle) live
// in `RenderPopupGameNodeExtras` below and merge in via `&`.
import type { RenderPopupLike as RenderPopupBase } from './GamePerp.js';
interface RenderPopupGameNodeExtras {
  jdomelem?: { on(ev: string, sel: string, handler: (e: unknown) => void): void };
  notificationMission?: string | null;
  callback?: () => void;
}
type RenderPopupLike = RenderPopupBase & RenderPopupGameNodeExtras;

/** GameRoot surface this base class touches in its mixin methods.
 *  Narrow forward-ref interface; collapses when GameRoot itself
 *  extracts to its own typed module. */
interface GameRootForGameNode {
  data: { status_icons?: unknown; [key: string]: unknown };
  renderNode?: RenderNodeLike;
  refresh(): void;
  getTypeFromGestalt(gestalt: string): string | undefined;
}

// `Render[renderType]` is dynamic — each renderType key resolves to a
// different constructor.  Resolved via the typed `pickRenderCtor` helper
// at the top of this module; the previous `RenderModule` structural
// surface (`[key:string]: unknown`) is retired in favour of a
// `keyof RenderApi`-constrained lookup.

// ---------------------------------------------------------------------------
// GameNode
// ---------------------------------------------------------------------------

export class GameNode {
  _id!: number;
  id!: string;
  children!: OrderedSet<GameNode>;
  states!: Record<string, boolean>;
  /** Backlink to the GameRoot instance (always _instances[0]). */
  GameRoot!: GameRoot;
  /** jQuery wrapper used as the GameNode's event bus. */
  jq!: JQueryLike;

  parentNode?: GameNode;
  renderNode?: RenderNodeLike;
  renderMenu?: RenderNodeLike;
  renderPopup?: RenderPopupLike;
  renderStatusbar?: RenderNodeLike;
  renderData?: RenderData;
  renderType?: string;
  renderNodeParent?: unknown;

  data?: Record<string, unknown>;
  gestalt?: string;
  gameType?: string;
  is_origin?: boolean;

  // Subclass-injected hooks; all optional.  Declared as method members
  // (rather than function-typed properties) so subclasses can `override`
  // them with normal class-body methods.
  extendEventHandlers?(): void;
  extendRender?(): void;
  APTick?(): void;
  AniTick?(): void;
  markReady?(): void;

  /** Set by Imperium / Database / Topscores / Missions in their
   *  constructors so descendant nodes can resolve a popup container. */
  ViewMap?: GameNode;

  // GameNode prototype mixin implementations live further down the
  // class body (extracted from scripts/Game.js's IIFE in PR 18 of
  // issue #147).  Subclasses (Database / the 10 Perp subclasses) call
  // these as regular methods.

  // Used by addType() to write into the type registry.  Real registry
  // lives on GameRoot in Game.js; the base just mutates whatever object
  // getType() returns.
  // (no field — legacy reads via this.GameRoot.getType().)

  constructor(config?: GameNodeConfig) {
    this.init(config);
  }

  toString(): string {
    return sprintf(
      'GameNode “%s”: %d children',
      this.renderType || String(this._id),
      this.children.length
    );
  }

  init(config?: GameNodeConfig): void {
    // Initialize GameNode and register it in the module-level _instances /
    // _ids registries.  Set children property for tree-structure.  Set
    // states registry of the GameNode.  Backlink to GameRoot for easy access
    // to GameRoot API.  setAttrs expands the config via generic setAttrs.
    // makeRenderConfig does the data crunching for the RenderAPI.  jq is the
    // jquery wrapper of the GameNode.  Initialise event handlers (usually
    // overwritten by the subclasses).
    const cfg = config || {};
    this._id = _instances.length;
    this.id = cfg.id || 'GameNode' + this._id;
    add(this);
    this.children = new OrderedSet<GameNode>();
    this.states = { idle: true };
    // _instances[0] is GameRoot by convention (first GameNode constructed).
    // Cast away the `| undefined` from get() — by the time any non-Root
    // GameNode is created, the Root must have been constructed first.
    // The `this` fallback covers GameRoot's own bootstrap (where it's the
    // only GameNode in existence and therefore *is* the GameRoot).
    this.GameRoot = (get(0) ?? this) as GameRoot;
    this.setAttrs(cfg);
    this.makeRenderConfig();
    this.jq = _$()(this);
    this.initEventHandlers();
  }

  remove(): void {
    if (this.parentNode) {
      this.parentNode.children.remove(this);
    }
    if (this.children) {
      // Recursively remove descendants so they're unregistered from the
      // module-level _instances / _ids registries.  Pre-fix the loop only
      // orphaned children (`delete child.parentNode`), leaving stale ids
      // resolvable via getById/getByGestalt and pinning whole subtrees
      // against GC.  Snapshot the array first because each child.remove()
      // would otherwise mutate `this.children` (via parentNode.children
      // .remove(this)) while we iterate.
      //
      // Ordering invariant: child.remove() runs while `this.parentNode`
      // and `this.renderNode` are still set on the parent.  Subclass
      // overrides that depend on parent state during their own teardown
      // (currently only Topscores' subscribePeersChanged cleanup, which
      // touches no parent fields) must keep working under this contract.
      const snapshot = this.children.set.slice();
      for (const child of snapshot) {
        child.remove();
      }
    }
    if (this.renderNode) {
      this.renderNode.remove();
    }
    if (this.renderMenu) {
      this.renderMenu.remove();
    }
    if (this.renderPopup) {
      this.renderPopup.close();
    }
    if (this.renderStatusbar) {
      this.renderStatusbar.remove();
    }
    remove(this._id);
  }

  addType(
    gestalt: string,
    data: { game_type?: string; type_data?: Record<string, unknown> }
  ): unknown {
    const groot = this.GameRoot as GameNode & { getTypeData(g: string): Record<string, unknown> };
    const nodeType = this.getType() as Record<string, unknown> | undefined;
    if (nodeType) {
      if (data.game_type && data.type_data) {
        const typeSettings = getTypeSettings() as Record<
          string,
          { type_data?: Record<string, unknown> }
        >;
        if (Object.prototype.hasOwnProperty.call(typeSettings, data.game_type)) {
          const merged = mergeData(typeSettings[data.game_type]?.type_data, data.type_data);
          merged.gestalt = gestalt;
          merged.game_type = data.game_type;
          // expand powerup tokens with their type data
          const tokens = merged.tokens;
          if (Array.isArray(tokens) && tokens.length) {
            tokens.forEach((v: { gestalt?: string; type_data?: unknown }) => {
              if (v && typeof v.gestalt === 'string') {
                v.type_data = groot.getTypeData(v.gestalt);
              }
            });
          }
          data.type_data = merged as Record<string, unknown>;
        }
        nodeType[gestalt] = data;
        return data;
      }
    }
    return undefined;
  }

  getType(gestalt?: string): unknown {
    const groot = this.GameRoot as GameNode & {
      getType(g: string | undefined): Record<string, unknown> | undefined;
    };
    const own: Record<string, unknown> = groot.getType(this.gestalt) ?? Object.create(null);
    if (gestalt) {
      return own[gestalt];
    }
    return own;
  }

  getTypeData(gestalt?: string): unknown {
    const t = this.getType(gestalt) as { type_data?: unknown } | undefined;
    return t ? t.type_data : undefined;
  }

  setState(state: string, value: boolean): void {
    // State change triggers event for renderNodes and renderPopups to listen
    // to.  The event is fed back to the GameNode, so listeners attached to
    // the GameNode also trigger.

    // do nothing when state is the same
    if (this.states[state] === value) {
      return;
    }
    this.states[state] = value;
    // TODO: Eventhook could be more generic but probably we only need
    // feedback in the popup.
    this.trigger('local_states', [state, value]);
    this.trigger('local_states_' + state, [value]);
    if (this.renderNode) {
      this.renderNode.trigger('states', [state, value]);
      this.renderNode.trigger('states_' + state, [value]);
    }
    if (this.renderPopup) {
      this.renderPopup.trigger('states', [state, value]);
      this.renderPopup.trigger('states_' + state, [value]);
    }
  }

  setAttrs(attrs: Record<string, unknown>): void {
    // Set any attribute(s).  Legacy behaviour: shallow-assign every own
    // property of `attrs` onto `this` (used to fold the constructor config
    // and ad-hoc subclass extensions).
    const self = this as unknown as Record<string, unknown>;
    for (const key in attrs) {
      if (Object.prototype.hasOwnProperty.call(attrs, key)) {
        self[key] = attrs[key];
      }
    }
  }

  load(): void {
    // FIXME: Do we need this?
  }

  save(): void {
    // FIXME: Do we need this?
  }

  addChild(child: GameNode): GameNode | false {
    // The GameNode Tree: Append a child to the GameNode.
    if (!child) {
      return false;
    }
    this.children.add(child);
    child.parentNode = this;
    return child;
  }

  on(event: string, func: (...args: unknown[]) => void): void {
    this.jq.on(event, func);
  }

  off(event?: string): void {
    this.jq.off(event);
  }

  trigger(event: string, params?: unknown[]): void {
    this.jq.trigger(event, params);
  }

  initEventHandlers(): void {
    this.on('vclick', function (e: unknown) {
      if (e && typeof (e as { stopPropagation?: () => void }).stopPropagation === 'function') {
        (e as { stopPropagation: () => void }).stopPropagation();
      }
    });
    if (this.extendEventHandlers) {
      this.extendEventHandlers();
    }
  }

  removeEventHandlers(): void {
    // Stupidly removes all event handlers.
    this.off();
  }

  makeRenderConfig(): RenderConfig {
    // Crunch data for render initialisation.
    // FIXME: this is mostly for data compatibility reasons, could be more
    // streamlined.
    if (!this.renderData) {
      this.renderData = {};
    }
    // `cfg` is typed as Record<string, unknown> while we assemble it so the
    // exactOptionalPropertyTypes-wrapped RenderConfig fields can take the
    // legacy `value || existing` truthy pattern without each line tripping
    // a "T | undefined not assignable to T" complaint.  Cast back at the end.
    const cfg = (this.renderData.config || {}) as Record<string, unknown>;

    const data = (this.data || {}) as Record<string, unknown>;
    cfg.id = this.id;
    cfg.name = data.name || cfg.name || this.id;

    cfg.x = data.x || cfg.x;
    cfg.y = data.y || cfg.y;

    cfg.width = data.width || cfg.width;
    cfg.height = data.height || cfg.height;

    cfg.label = data.label || cfg.label;

    cfg.zoomScale = data.zoom_scale || cfg.zoomScale;
    cfg.perpSprite = data.perp_sprite || cfg.perpSprite;

    cfg.perpBackground = data.perp_background || cfg.perpBackground;
    // FIXME: supertoken check with is_supertoken, not gestalt-inspection
    // (though would work).
    if (this.gestalt && this.gestalt.substring(0, 10) === 'supertoken') {
      cfg.perpBackground = data.perp_background2;
    }
    if (this.gestalt && this.gestalt.substring(0, 6) === 'origin') {
      this.is_origin = true;
      cfg.no_render = true;
    }
    if (this.gestalt && this.gestalt.substring(0, 5) === 'token') {
      const td = this.GameRoot.getTypeData(this.gestalt) as Record<string, unknown> | undefined;
      if (td) td.is_supertoken = false;
      if (this.data) (this.data as Record<string, unknown>).is_supertoken = false;
    }
    const bg = cfg.perpBackground;
    if (bg && typeof bg === 'object') {
      const bgRec = bg as Record<string, unknown>;
      for (const k in bgRec) {
        if (Object.prototype.hasOwnProperty.call(bgRec, k)) {
          cfg[k] = bgRec[k];
        }
      }
    }

    cfg.background = data.background || cfg.background;
    cfg.RenderTemplate = data.RenderTemplate || cfg.RenderTemplate;

    this.renderData.parentNode = this.renderNodeParent;
    this.renderData.config = cfg as RenderConfig;
    return cfg as RenderConfig;
  }

  updateRenderNode(render?: RenderData): void {
    // Test method: updates the rendered GameNode to the stored config.
    // FIXME: this probably is pointless, better to reinit a specific node?
    if (!this.renderData && !render) {
      return;
    }
    if (render) {
      this.renderData = render;
    }
    const rd = this.renderData;
    if (rd && Object.prototype.hasOwnProperty.call(rd, 'config') && this.renderNode) {
      this.renderNode.setAttrs?.(rd.config as RenderConfig);
    }
    this.renderNode?.draw?.();
  }

  render(): void {
    // Renders GameNode or recursively removes old RenderNodes and renders
    // anew.  FIXME: currently rerendering stuff has some problems with
    // decorators etc.
    if (this.renderNode) {
      this.renderNode.remove();
    }
    const render = this.renderData;

    if (render && render.config && !render.config.no_render) {
      const Render = getRender();
      const renderType = this.renderType ?? '';
      // Constrain the dynamic ctor lookup to `keyof RenderApi`; bail
      // out for renderType values not on the API (e.g. unset / typo).
      if (!(renderType in Render)) {
        return;
      }
      const RenderCtor = pickRenderCtor(renderType as keyof RenderApi) as unknown as
        | (new (
            cfg: RenderConfig
          ) => RenderNodeLike)
        | undefined;
      if (!RenderCtor) {
        return;
      }
      const node = new RenderCtor(render.config);
      this.renderNode = node;
      this.trigger('before_render');
      node.gameNode = this;
      // Put RenderNode in its place:
      if (render.parentNode) {
        const parentNode = Render.getById(render.parentNode as string);
        if (parentNode) {
          (parentNode as unknown as { addChild(n: RenderNodeLike): void }).addChild(node);
        }
      }

      // Execute subclass-specific render function.
      if (this.extendRender) {
        this.extendRender();
      }
      // after_render is only triggered when node rendered for the first time.
      this.trigger('after_render');
    }
    // FIXME: Recursion, maybe we better get rid of it and do rendering on
    // init and specific updates of the Tree.
    if (this.children.length) {
      this.children.each((child) => {
        child.render();
      });
    }
  }

  // -------------------------------------------------------------------
  // Mixin methods (extracted from scripts/Game.js's IIFE in PR 18 of
  // issue #147).  Used by Database, the 10 Perp subclasses, and other
  // GameNode descendants.  All forward-ref types live above the class
  // body; collapse when GameRoot / Render.js extract.
  // -------------------------------------------------------------------

  openGenericPopup(config: {
    gnode?: GameNode;
    data?: Record<string, unknown>;
    states?: Record<string, boolean>;
    template?: string;
    extendClass?: string;
    // Phase 2 (issue #80): when set, the popup body is rendered by a
    // Preact component instead of an Underscore.js template.  Mutually
    // exclusive with `template` — if `preactRender` is passed, the
    // template fallback ('popup.html') is suppressed.
    preactRender?: (container: HTMLElement, popup: RenderPopupLike) => void;
  }): RenderPopupLike {
    const gnode = config.gnode || this;
    const groot = this.GameRoot as unknown as GameRootForGameNode;
    const data = config.data || gnode.data;

    const ptd: Record<string, unknown> = {};
    ptd.status_icons = groot.data.status_icons;
    ptd.states = config.states || {};
    ptd.data = data;
    ptd.groot = groot;
    gnode.popupTemplateData = ptd;

    const Render = getRender() as Pick<RenderApi, 'Popup'>;
    const popup = new Render.Popup({
      gameNode: this,
      // Skip the template default when Preact owns the body; render()
      // branches on `preactRender` before reading `template`.
      template: config.preactRender ? '' : config.template || 'popup.html',
      extendClass: config.extendClass || '',
      templateData: gnode.popupTemplateData,
      popupContainer: this,
      preactRender: config.preactRender,
    } as unknown as ConstructorParameters<RenderApi['Popup']>[0]) as unknown as RenderPopupLike;
    this.renderPopup = popup;

    (gnode.renderNode as RenderNodeLike | undefined)?.addPopup?.(popup);

    gnode.initPopupEvents();

    return popup;
  }

  initPopupEvents(popup?: RenderPopupLike): void {
    const groot = this.GameRoot as unknown as GameRootForGameNode;
    const p = popup || (this.renderPopup as RenderPopupLike | undefined);
    if (!p) return;

    p.on('button_click.MainButton', (e: unknown) => {
      GameNode._stopProp(e);
      p.trigger('popup_close');
    });
    p.on('button_click.ChargeButton', (e: unknown) => {
      GameNode._stopProp(e);
      (this as GameNode & { Charge?(): void }).Charge?.();
    });
    p.on('button_click.CollectButton', (e: unknown) => {
      GameNode._stopProp(e);
      (this as GameNode & { collect?(): void }).collect?.();
    });

    p.on('popup_close', (e: unknown) => {
      GameNode._stopProp(e);
      if (p.notificationMission) {
        const gestalt = p.notificationMission;
        p.notificationMission = null;
        // No optimistic raw_data write: dismissMissionBriefing emits a
        // delta whose listener echo lands synchronously in this tick
        // (closes #116 race window under the #120 architectural fix).
        const remote = appModule.getApplication().remote as {
          dismissMissionBriefing?(g: string): unknown;
        };
        remote.dismissMissionBriefing?.(gestalt);
      }
      const subclass = this as GameNode & {
        highlightTabs?: string[];
      };
      if (subclass.highlightTabs) subclass.highlightTabs = [];
      const rn = this.renderNode as RenderNodeLike | undefined;
      if (rn?.DecoratorNew && this.gestalt) {
        getAllByGestalt(this.gestalt).forEach((gn) => {
          (gn.renderNode as RenderNodeLike | undefined)?.DecoratorNew?.remove();
        });
      }
      if (p.callback) {
        p.close(p.callback);
      } else {
        p.close();
      }
      delete this.renderPopup;
    });

    p.on('button_click.PowerupBuyButton', (e: unknown, bgestalt: unknown, bslot: unknown) => {
      GameNode._stopProp(e);
      (this as GameNode & { BuyPowerup?(g: unknown, s: unknown): void }).BuyPowerup?.(
        bgestalt,
        bslot
      );
    });
    p.on('button_click.PowerupBuySlotsButton', (e: unknown, bgestalt: unknown, bslot: unknown) => {
      GameNode._stopProp(e);
      (this as GameNode & { BuySlots?(s: unknown, g: unknown): void }).BuySlots?.(bslot, bgestalt);
    });
    p.on('button_click.PowerupSellButton', (e: unknown, bgestalt: unknown, bslot: unknown) => {
      GameNode._stopProp(e);
      (this as GameNode & { SellPowerup?(g: unknown, s: unknown): void }).SellPowerup?.(
        bgestalt,
        bslot
      );
    });

    p.on('popup_token_seen', (e: unknown, gestalt: unknown) => {
      GameNode._stopProp(e);
      if (typeof gestalt !== 'string' || !gestalt) return;
      // No optimistic raw_data write: markTokenSeen emits a delta whose
      // listener echo lands synchronously (closes #116 race window
      // under the #120 architectural fix).  The handler itself short-
      // circuits when the gestalt is already in tokens_seen, so calling
      // it twice is a no-op delta.
      const remote = appModule.getApplication().remote as {
        markTokenSeen?(g: string): unknown;
      };
      remote.markTokenSeen?.(gestalt);
    });

    p.on('button_click.PerpBuyButton', (e: unknown, bgestalt: unknown) => {
      GameNode._stopProp(e);
      if (typeof bgestalt !== 'string') return;
      const gtype = groot.getTypeFromGestalt(bgestalt);
      if (gtype === 'CityPerp') {
        const dbPerps = getByType('DatabasePerp') as Array<
          GameNode & { BuyCity?(g: string): void }
        >;
        if (!dbPerps.length) return;
        dbPerps[0]?.BuyCity?.(bgestalt);
      } else {
        (this as GameNode & { BuyPerp?(g: string): void }).BuyPerp?.(bgestalt);
      }
    });

    p.on('button_click.UpgradeButton', (e: unknown) => {
      GameNode._stopProp(e);
      (this as GameNode & { Charge?(): void }).Charge?.();
    });

    const $ = globalThis.$ as JQueryStatic | undefined;
    p.jdomelem?.on('click touchend', 'a.ml', function (this: unknown, e: unknown) {
      GameNode._stopProp(e);
      GameNode._preventDefault(e);
      // FIX for FF: open link in external window to prevent socketloss.
      const link = $?.(this as object).attr?.('href');
      if (typeof link === 'string') window.open(link);
    });
    p.jdomelem?.on('click touchend', 'a.mln', function (this: unknown, e: unknown) {
      GameNode._stopProp(e);
      GameNode._preventDefault(e);
      const link = $?.(this as object).attr?.('href');
      if (typeof link === 'string') window.open(link);
    });

    p.on('button_click.RefreshButton', (e: unknown) => {
      GameNode._stopProp(e);
      groot.refresh();
    });
  }

  fetchProvided(cb?: () => void): void {
    const dataRec = (this.data ||= {}) as {
      providedPerps?: unknown[];
      buyablePerps?: unknown;
    };
    dataRec.providedPerps = [];
    if (this.popupTemplateData) {
      (this.popupTemplateData as { loading?: boolean }).loading = true;
    }
    const remote = appModule.getApplication().remote as {
      getProvidedPerps?(path: string): {
        done(cb: (data: { result?: { buyable?: unknown } }) => void): {
          fail(cb: (data: unknown) => void): unknown;
        };
      };
    };
    const fn = remote.getProvidedPerps;
    if (!fn) {
      cb?.();
      return;
    }
    const path = (this as GameNode & { path?: string }).path || '';
    fn(path)
      .done((data) => {
        if (data.result?.buyable) {
          dataRec.buyablePerps = data.result.buyable;
          if (this.popupTemplateData) {
            (this.popupTemplateData as { loading?: boolean }).loading = false;
          }
          cb?.();
        }
      })
      .fail(() => {
        cb?.();
      });
  }

  Error(errormsg: string, data: unknown): void {
    const groot = this.GameRoot as unknown as GameRootForGameNode | undefined;
    const popup = this.renderPopup as RenderPopupLike | undefined;
    const rn = this.renderNode as RenderNodeLike | undefined;
    if (popup?.open) {
      popup.trigger('error');
    } else if (rn) {
      rn.FXError?.();
    } else if (groot) {
      groot.renderNode?.FXError?.();
    }
    if (setup.debug) {
      console.error(errormsg, data);
    }
  }

  NoCash(): void {
    const popup = this.renderPopup as RenderPopupLike | undefined;
    if (popup?.open) popup.trigger('no_cash');
    else (this.renderNode as RenderNodeLike | undefined)?.FXNoCash?.();
  }

  NoAP(): void {
    const popup = this.renderPopup as RenderPopupLike | undefined;
    if (popup?.open) popup.trigger('no_AP');
    else (this.renderNode as RenderNodeLike | undefined)?.FXNoAP?.();
  }

  // Property added by openGenericPopup / Perp.updateTemplateData.
  popupTemplateData?: Record<string, unknown>;

  // jQuery `Event.stopPropagation` / `preventDefault` are present at
  // runtime, but the `e` arg from the popup pub-sub / `gnode.on` event
  // bus is typed `unknown` at the migration boundary.  Centralised
  // helpers here so subclasses (Perp / GamePerp / Database) can call
  // through static inheritance without re-defining the narrow.
  protected static _stopProp(e: unknown): void {
    const fn = (e as { stopPropagation?: () => void } | null | undefined)?.stopPropagation;
    if (typeof fn === 'function') fn.call(e);
  }
  protected static _preventDefault(e: unknown): void {
    const fn = (e as { preventDefault?: () => void } | null | undefined)?.preventDefault;
    if (typeof fn === 'function') fn.call(e);
  }
}
