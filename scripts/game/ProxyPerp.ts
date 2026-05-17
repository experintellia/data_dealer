// ProxyPerp — proxy perp.  Same shape as AgentPerp (compileProvided
// at popup-open, IPerps flag at construction), plus a slot-status
// label decorator that updates after every render.  Extracted from
// scripts/Game.js's IIFE in PR 13 of issue #147.

import { type RenderApi, getRender } from '../Render.js';
import { ProvidedPerpPopup } from '../components/popups/ProvidedPerpPopup.js';
import i18n from '../i18n.js';
import { type GameNodeConfig } from './GameNode.js';
import { GamePerp, type RenderNodeLike, type RenderPopupLike } from './GamePerp.js';
import type { ProvidedContext } from './providedView.js';
import { buildProxyPopupVM } from './proxyView.js';

interface GameRootForProvided {
  xp_level: { number: number };
  DBTokens: Record<string, number>;
  getTypeFromGestalt(gestalt?: string): string;
}

export class ProxyPerp extends GamePerp {
  override renderType = 'Perp';
  override popupTemplate = 'popup_proxy.html';

  private providedCtx(): ProvidedContext {
    const g = this.groot as unknown as GameRootForProvided;
    return {
      xpLevel: g.xp_level.number,
      dbTokens: g.DBTokens,
      typeOf: (gestalt: string) => g.getTypeFromGestalt(gestalt),
    };
  }

  override openPopup(): RenderPopupLike {
    const vm = buildProxyPopupVM(
      (this.data ?? {}) as Parameters<typeof buildProxyPopupVM>[0],
      this.states,
      this.providedCtx()
    );
    return this.openPreactPopup(ProvidedPerpPopup, { vm }) as RenderPopupLike;
  }

  // Live-refetch re-mount (Path A) — see PusherPerp.updatePopup.
  override updatePopup(): RenderPopupLike {
    return this.openPopup();
  }

  constructor(config: GameNodeConfig) {
    super(config);
    this.textNewItems = i18n.gettext('New Ventures!');
    if (this.gestalt !== undefined) {
      this.groot.IPerps[this.gestalt] = true;
    }
  }

  override extendEventHandlers(): void {
    const gnode = this;
    gnode.compileProvided();

    gnode.on('after_render', function () {
      gnode.checkProvidedByLevel();
    });

    gnode.on('vclick', function (e: unknown) {
      ProxyPerp._stopProp(e);
      const dataRec = gnode.data as { used_slots?: number };
      dataRec.used_slots = gnode.children.set.length;
      gnode.fetchProvided?.(function () {
        gnode.compileProvided();
        if (gnode.renderPopup) {
          gnode.updatePopup();
        }
      });
      gnode.openPopup();
    });

    gnode.on('after_render', function () {
      gnode.updateRenderSlotStatus();
    });
  }

  updateRenderSlotStatus(): void {
    const node = this.renderNode as RenderNodeLike | undefined;
    if (!node) return;
    const Render = getRender() as Pick<RenderApi, 'DecoratorLabel'>;
    const dataRec = this.data as {
      label?: string;
      used_slots?: number;
      max_slots?: number;
    };
    dataRec.used_slots = this.children.set.length;
    const label = dataRec.label ?? '';
    const text =
      typeof dataRec.max_slots === 'number' && (dataRec.used_slots ?? 0) < dataRec.max_slots
        ? `${label}<br />${dataRec.used_slots}/${dataRec.max_slots}`
        : label;
    node.addDecorator?.(new Render.DecoratorLabel({ text }));
  }
}
