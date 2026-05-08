// Render — the runtime publisher that stitches together every
// extracted Render* class / helper module under a single
// `getRender()` accessor.  This file is the residue of what used
// to be a ~5,300-LOC `@ts-nocheck` IIFE; the issue #147 wave
// extracted every class into its own typed module under
// `scripts/render/`, leaving only:
//
//   - vendor-globals binding (jQuery `$`, underscore `_`,
//     `Scroller`, `core`, CreateJS `Easel` / `Tween` / `Sound` /
//     `Ticker` / `Ease`),
//   - the CreateJS `Ticker.{addListener,removeListener,setFPS}`
//     compat-shim that bolts the legacy listener-array API onto
//     the modern `EventDispatcher`,
//   - one-time seam wirings for the modules that legitimately
//     can't pull these vendor globals on their own
//     (`setRenderNodeTickers` / `applyRenderNodeFX` /
//     `setRenderCableResolution` / `setRenderViewsConfig`),
//   - the underscore `_.mixin({ RenderAmount, RenderSprite })`
//     template-helper registration,
//   - the publisher object that re-exports every Render* class /
//     instance under its legacy unprefixed name (`Node` / `Sprite`
//     / `ViewMap` / etc.) so external consumers and the
//     publisher-introspecting devtools stamp keep working
//     unchanged.
//
// PR 41 of issue #147 — the final-cleanup PR — closes #147 by
// dropping the last `@ts-nocheck` marker, flipping
// `allowJs: false` in tsconfig, and converting this residual
// shell to strict TS.

import { RenderButtonInline } from './render/RenderButtonInline.js';
import { RenderCable, RenderPerpCable, setRenderCableResolution } from './render/RenderCables.js';
import { RenderCircle } from './render/RenderCircle.js';
import {
  RenderDecorator,
  RenderDecoratorAmount,
  RenderDecoratorGear,
  RenderDecoratorLabel,
  RenderDecoratorNew,
  RenderDecoratorReady,
  RenderDecoratorTimer,
} from './render/RenderDecorators.js';
import { RenderDragHandler } from './render/RenderDragHandler.js';
import { RenderNode, setRenderNodeTickers } from './render/RenderNode.js';
import { applyRenderNodeFX } from './render/RenderNodeFX.js';
import { RenderPerp } from './render/RenderPerp.js';
import { RenderPerpSprite } from './render/RenderPerpSprite.js';
import { RenderSet } from './render/RenderSet.js';
import { RenderSlowTicker } from './render/RenderSlowTicker.js';
import { RenderSprite } from './render/RenderSprite.js';
import { RenderText } from './render/RenderText.js';
import {
  RenderDBQueue,
  RenderMissionPerp,
  RenderPopup,
  RenderStatusItem,
  RenderStatusbar,
  RenderTopscorePerp,
  renderAmountHtml,
} from './render/RenderTopLevelUI.js';
import {
  RenderMainMenu,
  RenderStage,
  RenderViewMap,
  RenderViewTab,
  setRenderViewsConfig,
} from './render/RenderViews.js';
import { _ids, _instances, clearAllNodes, getNode, getNodeById } from './render/renderRegistry.js';
import { renderSpriteHtml } from './render/renderSpriteHelper.js';
import setup from './setup.js';

// ── CreateJS vendor surface ────────────────────────────────────────────────
//
// Read off `globalThis.createjs` at factory-call time (the
// `<script>` tag for createjs-2015.11.26 loads before the ESM
// bundle).  Typed locally since there's no `@types/createjs`.

interface CreateJSTickerLike {
  addListener?(target: object): void;
  removeListener?(target: object): void;
  addEventListener(event: 'tick', fn: () => void): void;
  removeEventListener(event: 'tick', fn: () => void): void;
  setFPS?(fps: number): void;
  framerate: number;
  useRAF: boolean;
}

interface CreateJSGlobal {
  Ticker: CreateJSTickerLike;
  Tween: unknown;
  Ease: unknown;
}

interface UnderscoreMixinLike {
  mixin(mixins: Record<string, unknown>): void;
}

// ── publisher API surface ──────────────────────────────────────────────────
//
// Every entry mirrors the legacy IIFE publisher.  External
// consumers (game/*.ts) cast through their own structural surfaces
// since the wide class types here would couple their type graphs
// to ours; we keep the publisher loose-but-named so consumers can
// still discover the exported set.

export interface RenderApi {
  _instances: Array<RenderNode | undefined>;
  _ids: Record<string, RenderNode>;
  get(id: number): RenderNode | undefined;
  getById(id: string): RenderNode | undefined;
  clear(): void;
  DragHandler: typeof RenderDragHandler;
  Set: typeof RenderSet;
  Node: typeof RenderNode;
  Circle: typeof RenderCircle;
  Text: typeof RenderText;
  Sprite: typeof RenderSprite;
  Perp: typeof RenderPerp;
  PerpSprite: typeof RenderPerpSprite;
  PerpCable: typeof RenderPerpCable;
  Decorator: typeof RenderDecorator;
  DecoratorReady: typeof RenderDecoratorReady;
  DecoratorAmount: typeof RenderDecoratorAmount;
  DecoratorLabel: typeof RenderDecoratorLabel;
  DecoratorTimer: typeof RenderDecoratorTimer;
  DecoratorGear: typeof RenderDecoratorGear;
  DecoratorNew: typeof RenderDecoratorNew;
  Cable: typeof RenderCable;
  MissionPerp: typeof RenderMissionPerp;
  TopscorePerp: typeof RenderTopscorePerp;
  ViewTab: typeof RenderViewTab;
  ViewMap: typeof RenderViewMap;
  MainMenu: typeof RenderMainMenu;
  ButtonInline: typeof RenderButtonInline;
  Stage: typeof RenderStage;
  Popup: typeof RenderPopup;
  SlowTicker: typeof RenderSlowTicker;
  Statusbar: typeof RenderStatusbar;
  DBQueue: typeof RenderDBQueue;
}

// ── factory + singleton wrapper ────────────────────────────────────────────

function Render(): RenderApi {
  const cj = (globalThis as { createjs?: CreateJSGlobal }).createjs;
  if (!cj) {
    throw new Error('Render(): globalThis.createjs not loaded.');
  }
  const Ticker = cj.Ticker;
  const Tween = cj.Tween;
  const Ease = cj.Ease;

  // Shim CreateJS legacy Ticker.{addListener,removeListener,setFPS}
  // onto the current EventDispatcher API so Render's tick-object
  // callers work.
  if (typeof Ticker.addListener !== 'function') {
    const _tickHandlers = new WeakMap<object, () => void>();
    Ticker.addListener = (obj: object): void => {
      if (_tickHandlers.has(obj)) {
        return;
      }
      const fn = (): void => {
        const tickable = obj as { tick?: () => void };
        if (typeof tickable.tick === 'function') {
          tickable.tick();
        }
      };
      _tickHandlers.set(obj, fn);
      Ticker.addEventListener('tick', fn);
    };
    Ticker.removeListener = (obj: object): void => {
      const fn = _tickHandlers.get(obj);
      if (fn) {
        Ticker.removeEventListener('tick', fn);
        _tickHandlers.delete(obj);
      }
    };
  }
  // Always override setFPS so we use the modern `framerate=` setter
  // even when the legacy method still exists (it logs a deprecation
  // warning on every call in current TweenJS builds).
  Ticker.setFPS = (fps: number): void => {
    Ticker.framerate = fps;
  };

  const renderConf = {
    cableResolution: 2,
    tickerFramerate: 60,
    slowTickerFrameRate: 120,
    viewMapPerspective: setup.viewMapPerspective,
    viewMapStopZone: setup.viewMapStopZone,
  };

  Ticker.setFPS(renderConf.tickerFramerate);
  Ticker.useRAF = true;

  // ── seam wirings ─────────────────────────────────────────────────────────
  //
  // RenderNode's `remove()` unregisters from CreateJS Ticker and
  // RenderSlowTicker — both targets are fully resolved at this
  // point.  RenderNodeFX needs Ticker / Tween / Ease handed in
  // since it can't read off the createjs global at module load
  // (createjs script tag may not have parsed yet).
  setRenderNodeTickers({
    tickerRemove: (node) => {
      Ticker.removeListener?.(node);
    },
    slowTickerRemove: (node) => {
      RenderSlowTicker.removeListener(node);
    },
  });

  applyRenderNodeFX({
    Ticker: Ticker as unknown as Parameters<typeof applyRenderNodeFX>[0]['Ticker'],
    Tween: Tween as Parameters<typeof applyRenderNodeFX>[0]['Tween'],
    Ease: Ease as Parameters<typeof applyRenderNodeFX>[0]['Ease'],
  });
  setRenderCableResolution(renderConf.cableResolution);
  setRenderViewsConfig({ viewMapStopZone: renderConf.viewMapStopZone });

  // ── underscore mixins (template-helper registration) ─────────────────────

  const _u = globalThis._ as unknown as UnderscoreMixinLike;
  _u.mixin({
    RenderAmount: renderAmountHtml,
    RenderSprite: renderSpriteHtml,
  });

  // ── publisher ────────────────────────────────────────────────────────────

  return {
    _instances,
    _ids,
    get: getNode,
    getById: getNodeById,
    clear: clearAllNodes,
    DragHandler: RenderDragHandler,
    Set: RenderSet,
    Node: RenderNode,
    Circle: RenderCircle,
    Text: RenderText,
    Sprite: RenderSprite,
    Perp: RenderPerp,
    PerpSprite: RenderPerpSprite,
    PerpCable: RenderPerpCable,
    Decorator: RenderDecorator,
    DecoratorReady: RenderDecoratorReady,
    DecoratorAmount: RenderDecoratorAmount,
    DecoratorLabel: RenderDecoratorLabel,
    DecoratorTimer: RenderDecoratorTimer,
    DecoratorGear: RenderDecoratorGear,
    DecoratorNew: RenderDecoratorNew,
    Cable: RenderCable,
    MissionPerp: RenderMissionPerp,
    TopscorePerp: RenderTopscorePerp,
    ViewTab: RenderViewTab,
    ViewMap: RenderViewMap,
    MainMenu: RenderMainMenu,
    ButtonInline: RenderButtonInline,
    Stage: RenderStage,
    Popup: RenderPopup,
    SlowTicker: RenderSlowTicker,
    Statusbar: RenderStatusbar,
    DBQueue: RenderDBQueue,
  };
}

let _render: RenderApi | undefined;

export function getRender(): RenderApi {
  if (!_render) {
    _render = Render();
  }
  return _render;
}

export default { getRender };
