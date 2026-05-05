// AgentPerp — agent perp.  Compiles its provided perps at popup-open
// and flags `IPerps[gestalt]` at construction so the buy dialog of
// other perps can check ownership.  Extracted from scripts/Game.js's
// IIFE in PR 13 of issue #147.

import i18n from '../i18n.js';
import { type GameNodeConfig } from './GameNode.js';
import { GamePerp } from './GamePerp.js';

export class AgentPerp extends GamePerp {
  override renderType = 'Perp';
  override popupTemplate = 'popup_agent.html';

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
