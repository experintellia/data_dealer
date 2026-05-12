// Topscores — leaderboard view-tab parent.  Holds one Topscore child per
// ranking type (cash / xp / profiles / level / spent), each rendered via
// the Render API.  Extracted from scripts/Game.js's IIFE in PR 6 of
// issue #147.

import * as bootMod from '../boot.js';
import i18n from '../i18n.js';
import {
  GameNode,
  type GameNodeConfig,
  getByFirstId,
  getByGestalt,
  getFirstId,
} from './GameNode.js';
import { OrderedSet } from './OrderedSet.js';
import { Topscore } from './Topscore.js';

interface TopscoreRenderNodeMenu {
  hide?: () => void;
  show?: () => void;
  hidden?: boolean;
  jdomelem?: {
    find?: (sel: string) => { addClass?: (c: string) => void };
  };
}

export class Topscores extends GameNode {
  override renderType = 'ViewTab';
  // Narrow the inherited `children: OrderedSet<GameNode>` to the actual
  // shape Topscores produces — every child added via initTopscore() is a
  // Topscore instance.  Type-only override (`declare`); no runtime change.
  declare children: OrderedSet<Topscore>;
  ViewMap?: Topscores;
  queue?: OrderedSet<unknown>;
  /** Unsubscribe handle returned by `bootMod.subscribePeersChanged()` in
   *  extendEventHandlers; invoked from remove() so the listener doesn't
   *  outlive the GameNode (see audit bug #8). */
  private _peersUnsub?: () => void;

  constructor(config?: GameNodeConfig) {
    // The legacy constructor stamped these *before* calling init() so that
    // subclass extendEventHandlers() (called from init via initEventHandlers)
    // could read this.queue / this.ViewMap.  Replicating the order here:
    // super() runs first (which invokes init), but we can't pre-stamp before
    // the super call.  Move the stamps to happen *after* super(): no
    // observable difference because nothing in init() reads queue/ViewMap.
    super(config);
    this.ViewMap = this;
    this.queue = new OrderedSet();
  }

  initTopscore(type: string | undefined): Topscore | undefined {
    if (type === undefined) return undefined;
    const cfg: GameNodeConfig = {
      id: 'Topscore' + type,
      gestalt: 'topscore_' + type,
      states: { complete: false, active: false },
      scoretype: type,
      renderNodeParent: getFirstId('Topscores'),
      ViewMap: getByFirstId('Topscores'),
      gameType: 'Topscore',
    };
    const td = this.GameRoot.getTypeData('Topscore') as Record<string, unknown> | undefined;
    if (td) cfg.data = td;
    const score = new Topscore(cfg);
    this.addChild(score);
    score.render();
    (score.renderNode as TopscoreRenderNodeMenu | undefined)?.hide?.();
    return score;
  }

  updateScores(): void {
    this.children.each((score) => {
      score.lastFetch = null;
      score.fetchScore(score.scoretype, true);
    });
  }

  override extendRender(): void {
    this.GameRoot.renderMenu?.addButton?.(i18n.gettext('Topscores'), this.id, this.states);
  }

  override extendEventHandlers(): void {
    const gnode = this;

    gnode.on('viewtab_selected', function () {
      let all_hidden = true;
      gnode.children.each((score) => {
        score.fetchScore();
        const rn = score.renderNode as TopscoreRenderNodeMenu | undefined;
        if (rn && !rn.hidden) {
          all_hidden = false;
        }
      });
      const first = gnode.children.set[0];
      if (first && all_hidden && gnode.children.length) {
        const firstRn = first.renderNode as TopscoreRenderNodeMenu | undefined;
        firstRn?.show?.();
        const ownRn = gnode.renderNode as TopscoreRenderNodeMenu | undefined;
        ownRn?.jdomelem
          ?.find?.('.ViewTabMenuButton[data-button-gestalt="' + first.scoretype + '"]')
          ?.addClass?.('active');
      }
    });

    gnode.on('button_click.ViewTabMenuButton', function (e: unknown, type: unknown) {
      if (e && typeof (e as { stopPropagation?: () => void }).stopPropagation === 'function') {
        (e as { stopPropagation: () => void }).stopPropagation();
      }
      const t = typeof type === 'string' ? type : undefined;
      if (!t) return;
      const score = getByGestalt('topscore_' + t) as Topscore | undefined;
      if (!score) return;
      gnode.children.each((ts) => {
        const rn = ts.renderNode as TopscoreRenderNodeMenu | undefined;
        rn?.hide?.();
      });
      const scoreRn = score.renderNode as TopscoreRenderNodeMenu | undefined;
      scoreRn?.show?.();
      score.fetchScore();
    });

    // Live leaderboard refresh on every state.peers ref change.  Persist
    // the unsubscribe handle so remove() can detach the listener — pre-fix
    // the handle was dropped on the floor, leaking the listener if the
    // Topscores node was ever torn down (tests, view teardown, etc.).
    if (bootMod && typeof bootMod.subscribePeersChanged === 'function') {
      this._peersUnsub = bootMod.subscribePeersChanged(function () {
        gnode.updateScores();
      });
    }
  }

  override remove(): void {
    if (this._peersUnsub) {
      try {
        this._peersUnsub();
      } finally {
        delete this._peersUnsub;
      }
    }
    super.remove();
  }
}
