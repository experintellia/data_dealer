// DatabasePerp — the Database's GameNode-side perp wrapper. The actual
// Database logic lives in scripts/game/Database.ts; this class is the
// `Perp` rendering of the Database in the imperium graph and handles
// the `BuyCity` flow (server round-trip + new-perp creation, similar
// to GamePerp.BuyPerp but with City-specific placement geometry +
// ProfileSet cuing on the response).
//
// Extracted from scripts/Game.js's IIFE in PR 12 of issue #147.

import { getRender } from '../Render.js';
import appModule from '../app.js';
import i18n from '../i18n.js';
import { getByFirstId, getByType, getFirstId } from './GameNode.js';
import { GamePerp } from './GamePerp.js';
import { mergeData } from './mergeData.js';
import { lookupPerpClass } from './perpRegistry.js';

interface RenderNodeLike {
  cableAnimatedTo?(target: unknown, opts: { mode: string }, cb?: () => void): void;
  addDecorator?(deco: unknown): unknown;
  hide?(): void;
  getPosition?(): { x: number; y: number };
  getVectorTo?(target: unknown): unknown;
  getVectorPos?(vector: unknown, ratio: number): { x: number; y: number };
  parentNode?: { scrollTo?(pos: { x: number; y: number }): void };
  FXNoCash?(): void;
  FXArise?(cb?: () => void): void;
  FXBounce?(): void;
}

interface RenderPopupLike {
  open?: boolean;
  trigger(ev: string, args?: unknown[]): void;
}

interface BuyPerpResult {
  game_values?: Record<string, unknown>;
  levelup?: boolean;
  missions?: unknown;
  profile_set?: { profile_set?: unknown; origin?: unknown; collect_id?: unknown };
  node?: {
    game_id?: string;
    game_type?: string;
    full_path?: string;
    instance_data?: Record<string, unknown>;
  };
  error?: number;
}

interface DoneFailChain<T> {
  done(cb: (data: { result?: T }) => void): DoneFailChain<T>;
  fail(cb: (data: unknown) => void): DoneFailChain<T>;
}

interface GameRootForDatabasePerp {
  renderPopup?: RenderPopupLike;
  updateGameValues(
    gv: Record<string, unknown>,
    levelup?: boolean,
    missions?: unknown,
    quiet?: boolean
  ): void;
  trigger(ev: string, args?: unknown[]): void;
  getTypeData(gestalt?: string): Record<string, unknown> | undefined;
  getDatabase(): {
    cue(ps: unknown, origin: unknown, collect_id: unknown): unknown;
  };
}

export class DatabasePerp extends GamePerp {
  override renderType = 'Perp';

  override extendEventHandlers(): void {
    const gnode = this;
    this.on('vclick', function (e: unknown) {
      const stop = (e as { stopPropagation?: () => void } | null | undefined)?.stopPropagation;
      if (typeof stop === 'function') stop.call(e);
      gnode.trigger('switch_view', ['Database']);
    });
  }

  BuyCity(bgestalt: string, placePos?: { x: number; y: number }): void {
    const gnode = this;
    const groot = this.GameRoot as unknown as GameRootForDatabasePerp;
    const Render = getRender() as unknown as {
      DecoratorNew: new (cfg: unknown) => unknown;
    };
    const buyPerpFn = appModule.getApplication().remote.buyPerp;
    if (!buyPerpFn) return;
    const path = gnode.path || '';
    const call = buyPerpFn(path, bgestalt) as unknown as DoneFailChain<BuyPerpResult>;
    call.done(function (data) {
      if (!data.result) {
        gnode.Error?.('The computer says NOOOO', data);
        return;
      }
      const r = data.result;
      if (r.error !== undefined) {
        if (gnode.renderPopup && (gnode.renderPopup as RenderPopupLike).open) {
          (gnode.renderPopup as RenderPopupLike).trigger('no_cash');
        } else {
          (gnode.renderNode as RenderNodeLike | undefined)?.FXNoCash?.();
        }
        return;
      }
      if (groot.renderPopup) {
        groot.renderPopup.trigger('popup_close');
      }
      getByType('CityPerp').forEach((city) => {
        if (city.renderPopup) {
          (city.renderPopup as RenderPopupLike).trigger('popup_close');
        }
      });

      if (!r.node) return;
      groot.updateGameValues(r.game_values || {}, r.levelup === true, r.missions);

      const node = r.node;
      const nodeGameType = node.game_type;
      if (!nodeGameType) return;
      const Ctor = lookupPerpClass(nodeGameType);
      if (!Ctor) return;
      const node_data = groot.getTypeData(bgestalt);
      const perp = new Ctor({
        id: node.game_id,
        gestalt: bgestalt,
        path: node.full_path,
        noConnect: true,
        data: mergeData(node_data, node.instance_data),
        renderNodeParent: getFirstId('Imperium'),
        ViewMap: getByFirstId('Imperium'),
        gameType: nodeGameType,
      }) as GamePerp & {
        renderData: {
          config: {
            placeRandom?: { x: number; y: number };
            placeParentRadius?: number;
            hidden?: boolean;
          };
        };
      };
      gnode.addChild(perp);

      const gnodeRn = gnode.renderNode as RenderNodeLike | undefined;

      // Place the first city at a defined offset from the DB; every
      // other city on the opposite side of the first found city.
      if (!placePos) {
        const pos = gnodeRn?.getPosition?.();
        if (pos) {
          placePos = { x: pos.x - 250, y: pos.y + 50 };
        }
      }
      if (gnode.children.set && gnode.children.set.length >= 2) {
        const oppositeCity = gnode.children.set.find(
          (c) => (c as { gameType?: string }).gameType === 'CityPerp'
        );
        const oppRn = oppositeCity?.renderNode as RenderNodeLike | undefined;
        if (oppRn && gnodeRn) {
          const vector = oppRn.getVectorTo?.(gnodeRn);
          const calced = vector ? gnodeRn.getVectorPos?.(vector, 1) : undefined;
          if (calced) placePos = calced;
        }
      }

      if (placePos) perp.renderData.config.placeRandom = placePos;
      perp.renderData.config.placeParentRadius = 400;
      perp.renderData.config.hidden = true;

      perp.render();
      const perpRn = perp.renderNode as RenderNodeLike | undefined;
      const perpPos = perpRn?.getPosition?.();
      if (perp.path && perpPos) {
        groot.trigger('saveCoords', [perp.path, perpPos]);
      }
      perpRn?.addDecorator?.(
        new Render.DecoratorNew({ text: i18n.gettext('New!'), extendClass: 'NewPerp' })
      );
      perpRn?.hide?.();
      if (perpPos) perpRn?.parentNode?.scrollTo?.(perpPos);

      window.setTimeout(function () {
        perpRn?.FXArise?.(function () {
          gnodeRn?.cableAnimatedTo?.(perpRn, { mode: perp.cableType }, function () {
            if (perp.cableType === 'in') {
              perpRn?.FXBounce?.();
            } else if (perp.cableType === 'out') {
              gnodeRn?.FXBounce?.();
            } else {
              gnodeRn?.FXBounce?.();
              perpRn?.FXBounce?.();
            }
          });
        });
      }, 300);

      const ps = r.profile_set;
      if (ps) {
        groot.getDatabase().cue(ps.profile_set, ps.origin, ps.collect_id);
      }
      perp.trigger('after_buy');
    });
  }

  override BuyPerp(bgestalt: string, placePos?: { x: number; y: number }): void {
    this.BuyCity(bgestalt, placePos);
  }
}
