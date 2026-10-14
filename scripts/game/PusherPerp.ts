// PusherPerp — pusher perp.  Same compileProvided + popup-open shape
// as AgentPerp / ProxyPerp; differs only in `cableType: 'out'` and
// the `checkProvidedByRequiredPerps` walker on `after_render` (vs.
// AgentPerp/ProxyPerp's `checkProvidedByLevel`).
//
// Extracted from scripts/Game.js's IIFE in PR 14 of issue #147.

import { ProvidedPerpPopup } from '../components/popups/ProvidedPerpPopup.js';
import i18n from '../i18n.js';
import { type GameNodeConfig } from './GameNode.js';
import { GamePerp, type RenderPopupLike } from './GamePerp.js';
import { buildPusherPopupVM } from './pusherView.js';

export class PusherPerp extends GamePerp {
  override renderType = 'Perp';
  override cableType = 'out' as const;
  override labelClass = 'client';

  override openPopup(): RenderPopupLike {
    const vm = buildPusherPopupVM(
      (this.data ?? {}) as Parameters<typeof buildPusherPopupVM>[0],
      this.states,
      this.providedCtx()
    );
    return this.openPreactPopup(ProvidedPerpPopup, { vm }) as RenderPopupLike;
  }

  // Live-refetch (vclick → fetchProvided → compileProvided →
  // updatePopup): Path A re-mount.  openDialog closes the active
  // dialog and mounts the fresh VM, matching the legacy rebuild.
  override updatePopup(): RenderPopupLike {
    return this.openPopup();
  }

  constructor(config: GameNodeConfig) {
    super(config);
    this.textNewItems = i18n.gettext('New Clients!');
    if (this.gestalt !== undefined) {
      this.groot.IPerps[this.gestalt] = true;
    }
  }

  override extendEventHandlers(): void {
    const gnode = this;
    gnode.compileProvided();

    gnode.on('after_render', function () {
      gnode.checkProvidedByRequiredPerps();
    });

    gnode.on('vclick', function (e: unknown) {
      PusherPerp._stopProp(e);
      gnode.openPopupAndRefetchProvided();
    });
  }
}
