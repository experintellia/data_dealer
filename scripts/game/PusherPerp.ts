// PusherPerp — pusher perp.  Same compileProvided + popup-open shape
// as AgentPerp / ProxyPerp; differs only in `cableType: 'out'` and
// the `checkProvidedByRequiredPerps` walker on `after_render` (vs.
// AgentPerp/ProxyPerp's `checkProvidedByLevel`).
//
// Extracted from scripts/Game.js's IIFE in PR 14 of issue #147.

import i18n from '../i18n.js';
import { type GameNodeConfig } from './GameNode.js';
import { GamePerp, type GameRootForPerp } from './GamePerp.js';

export class PusherPerp extends GamePerp {
  override renderType = 'Perp';
  override cableType = 'out' as const;
  override labelClass = 'client';
  override popupTemplate = 'popup_pusher.html';

  constructor(config: GameNodeConfig) {
    super(config);
    this.textNewItems = i18n.gettext('New Clients!');
    if (this.gestalt !== undefined) {
      (this.GameRoot as unknown as GameRootForPerp).IPerps[this.gestalt] = true;
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
