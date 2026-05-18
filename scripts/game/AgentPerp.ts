// AgentPerp — agent perp.  Compiles its provided perps at popup-open
// and flags `IPerps[gestalt]` at construction so the buy dialog of
// other perps can check ownership.  Same compileProvided + popup-open
// shape as ProxyPerp (perp.html tiles, checkProvidedByLevel); the
// Preact buy dialog is the shared ProvidedPerpPopup (issue #80 tier 6,
// mirroring the tier-5c Pusher/Proxy port).
//
// Extracted from scripts/Game.js's IIFE in PR 13 of issue #147.

import { ProvidedPerpPopup } from '../components/popups/ProvidedPerpPopup.js';
import i18n from '../i18n.js';
import { type GameNodeConfig } from './GameNode.js';
import { GamePerp, type RenderPopupLike } from './GamePerp.js';
import { buildAgentPopupVM } from './agentView.js';
import type { ProvidedContext } from './providedView.js';

interface GameRootForProvided {
  xp_level: { number: number };
  DBTokens: Record<string, number>;
  getTypeFromGestalt(gestalt?: string): string;
}

export class AgentPerp extends GamePerp {
  override renderType = 'Perp';
  override popupTemplate = 'popup_agent.html';

  private providedCtx(): ProvidedContext {
    const g = this.groot as unknown as GameRootForProvided;
    return {
      xpLevel: g.xp_level.number,
      dbTokens: g.DBTokens,
      typeOf: (gestalt: string) => g.getTypeFromGestalt(gestalt),
    };
  }

  override openPopup(): RenderPopupLike {
    const vm = buildAgentPopupVM(
      (this.data ?? {}) as Parameters<typeof buildAgentPopupVM>[0],
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
    this.textNewItems = i18n.gettext('New Contacts!');
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
      AgentPerp._stopProp(e);
      gnode.fetchProvided?.(function () {
        gnode.compileProvided();
        if (gnode.renderPopup) {
          gnode.updatePopup();
        }
      });
      gnode.openPopup();
    });
  }
}
