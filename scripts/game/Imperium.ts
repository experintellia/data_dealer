// Imperium — the player's empire view (the main ViewMap with all the
// Perp instances laid out).  Smallest extends-GameNode subclass.
// Extracted from scripts/Game.js's IIFE in PR 8 of issue #147.

import i18n from '../i18n.js';
import { GameNode } from './GameNode.js';

interface ImperiumRenderNode {
  lock?(): void;
  unlock?(): void;
}

export class Imperium extends GameNode {
  override renderType = 'ViewMap';
  ViewMap?: Imperium;

  constructor(config?: ConstructorParameters<typeof GameNode>[0]) {
    super(config);
    this.ViewMap = this;
  }

  override extendRender(): void {
    this.setState('active', true);
    // FIXME: name should be in data
    // this.GameRoot.renderMenu.addButton(this.renderData.config.name, this.id, this.states);
    this.GameRoot.renderMenu?.addButton?.(i18n.gettext('My Empire'), this.id, this.states);
  }

  lock(): void {
    (this.renderNode as ImperiumRenderNode | undefined)?.lock?.();
  }

  unlock(): void {
    (this.renderNode as ImperiumRenderNode | undefined)?.unlock?.();
  }
}
