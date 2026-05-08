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
//   - one-time seam wirings for the modules that legitimately
//     can't pull these vendor globals on their own
//     (`applyRenderNodeFX`),
//   - the underscore `_.mixin({ RenderAmount, RenderSprite })`
//     template-helper registration,
//   - the publisher object that re-exports every Render* class /
//     instance under its legacy unprefixed name (`Node` / `Sprite`
//     / `ViewMap` / etc.) so external consumers and the
//     publisher-introspecting devtools stamp keep working
//     unchanged.

import { RenderButtonInline } from './render/RenderButtonInline.js';
import { RenderCable, RenderPerpCable } from './render/RenderCables.js';
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
import { RenderNode } from './render/RenderNode.js';
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
import { RenderMainMenu, RenderStage, RenderViewMap, RenderViewTab } from './render/RenderViews.js';
import { tickerSetFPS, tickerSetUseRAF } from './render/renderCreatejsTicker.js';
import { _ids, _instances, clearAllNodes, getNode, getNodeById } from './render/renderRegistry.js';
import { renderSpriteHtml } from './render/renderSpriteHelper.js';

// ── CreateJS vendor surface ────────────────────────────────────────────────
//
// Read off `globalThis.createjs` at factory-call time (the
// `<script>` tag for createjs-2015.11.26 loads before the ESM
// bundle).  Typed locally since there's no `@types/createjs`.
// The CreateJS Ticker singleton + its legacy listener-array shim
// live in `./render/renderCreatejsTicker.js` — Render.ts only needs
// `Tween` / `Ease` for the FX seam now.

interface CreateJSGlobal {
  Ticker: unknown;
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
  const Tween = cj.Tween;
  const Ease = cj.Ease;

  // First call into renderCreatejsTicker installs the legacy
  // listener-array shim onto the CreateJS Ticker singleton, so
  // RenderNodeFX's `Ticker.addListener` calls find a function.
  tickerSetFPS(60);
  tickerSetUseRAF(true);

  // ── seam wirings ─────────────────────────────────────────────────────────
  //
  // RenderNodeFX needs Tween / Ease handed in since it can't read off
  // the createjs global at module load (createjs script tag may not
  // have parsed yet).  Ticker access lives in renderCreatejsTicker
  // and resolves the singleton lazily on first use.
  applyRenderNodeFX({
    Tween: Tween as Parameters<typeof applyRenderNodeFX>[0]['Tween'],
    Ease: Ease as Parameters<typeof applyRenderNodeFX>[0]['Ease'],
  });

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
