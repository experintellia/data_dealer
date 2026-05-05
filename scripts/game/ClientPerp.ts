// ClientPerp — client perp (formerly Customer).  Implements the same
// charge → markReady → collect lifecycle as ContactPerp but pays out
// in cash (FXKatsching, MoneyBling) instead of profile data, and
// derives its income from the DB token mix via getIncome / getKarma-
// Penalty (the karma factor scales the income on negative karma).
//
// Extracted from scripts/Game.js's IIFE in PR 15 of issue #147.

import { getRender } from '../Render.js';
import appModule from '../app.js';
import { type GameNodeConfig } from './GameNode.js';
import {
  type DoneFailChain,
  GamePerp,
  type GameRootForPerp,
  type RenderNodeLike,
  type RenderPopupLike,
} from './GamePerp.js';
import { ProfileSet } from './ProfileSet.js';

interface DecoratorReadyLike {
  on(ev: string, handler: (...args: unknown[]) => void): void;
  setClickable(v: boolean): void;
  setFrame(name: string): void;
  remove(): void;
  FXSproing(): void;
  FXPulse(): void;
  FXBling(opts: { text: string; extendClass?: string; wait?: number }): void;
  FXKatsching(cb?: () => void): void;
  FXNoAP(): void;
  FXStop(): void;
  FXError(): void;
}

interface ClientRenderNodeLike extends RenderNodeLike {
  FXDataIn?(): void;
  FXCharge?(arg?: string): void;
  FXNoAP?(): void;
  FXAP?(): void;
}

interface TokenRef {
  gestalt: string;
  amount: number;
}

interface ChargeResult {
  error?: number;
  game_values?: Record<string, unknown>;
  levelup?: boolean;
  missions?: unknown;
  duration?: number;
}

interface CollectResult {
  result?: { cash: number; [k: string]: unknown };
  error?: number;
  game_values?: Record<string, unknown> & { karma_value?: number };
  levelup?: boolean;
  missions?: unknown;
  karma_incident?: string;
}

interface GameRootForClientPerp extends GameRootForPerp {
  ap_value: number;
  karma_value: number;
  getDBTokenAmount(gestalt: string): number;
  getDBFactorNormalized(): number;
}

export class ClientPerp extends GamePerp {
  override renderType = 'Perp';
  override cableType = 'out' as const;
  override labelClass = 'client';
  override sticky = false;
  override popupTemplate = 'popup_client.html';

  renderReady?: DecoratorReadyLike;

  protected override get groot(): GameRootForClientPerp {
    return this.GameRoot as unknown as GameRootForClientPerp;
  }

  constructor(config: GameNodeConfig) {
    super(config);
    if (this.gestalt !== undefined) {
      this.groot.IPerps[this.gestalt] = true;
    }
  }

  override AniTick(): void {
    (this.renderNode as ClientRenderNodeLike | undefined)?.FXDataIn?.();
  }

  getKarmaPenalty(): number {
    const groot = this.groot;
    const karma = groot.karma_value;
    let karma_factor = (karma + 100) / 200 + 0.5;
    karma_factor = karma_factor > 1 ? 1 : karma_factor;
    const dataRec = (this.data || {}) as { karma_penalty?: boolean };
    dataRec.karma_penalty = karma_factor < 1;
    return karma_factor;
  }

  getIncome(nopenalty?: boolean): number {
    const groot = this.groot;
    const dataRec = (this.data || {}) as {
      income_base?: number;
      income_factor?: number;
      consumed_tokens?: TokenRef[];
    };
    const base_income = dataRec.income_base ?? 0;
    const base_income_factor = dataRec.income_factor ?? 0;
    const consumed_tokens = dataRec.consumed_tokens ?? [];
    let amount = consumed_tokens.reduce((memo, token) => {
      return memo + (groot.getDBTokenAmount(token.gestalt) * token.amount) / 10000;
    }, 0);
    const db_fill_factor = groot.getDBFactorNormalized();
    const karma_penalty_factor = nopenalty ? 1 : this.getKarmaPenalty();
    amount = (amount * db_fill_factor) ** 0.6;
    return Number.parseInt(
      String(
        karma_penalty_factor *
          Math.round(base_income + amount * base_income * (base_income_factor / 1000))
      )
    );
  }

  override extendEventHandlers(): void {
    const gnode = this;

    gnode.on('vshiftclick', function (e: unknown) {
      ClientPerp._stopProp(e);
      gnode.Charge();
    });

    gnode.on('vclick', function (e: unknown) {
      ClientPerp._stopProp(e);
      // FIXME: Compile some data, move to extra method
      const dataRec = gnode.data as {
        ProfileSet?: unknown;
        ConsumedProfileSet?: unknown;
        income?: number;
        income_nopenalty?: number;
        consumed_tokens?: ConstructorParameters<typeof ProfileSet>[1];
      };
      dataRec.ProfileSet = new ProfileSet(
        { DBAmounts: true, lockNotInDB: true, filter_is_query: 'blue', sortByGestalt: true },
        dataRec.consumed_tokens ?? []
      );
      dataRec.ConsumedProfileSet = new ProfileSet(
        { lockNotInDB: true, DBAmounts: true, filter_is_query: 'orange', sortByGestalt: true },
        dataRec.consumed_tokens ?? []
      );
      dataRec.income = gnode.getIncome();
      dataRec.income_nopenalty = gnode.getIncome(true);
      gnode.openPopup();
    });

    gnode.on('node_ready', function (e: unknown) {
      ClientPerp._stopProp(e);
      gnode.markReady();
    });
  }

  collect(): void {
    const gperp = this;
    const groot = this.groot;
    const deco = gperp.renderReady;
    const popup = gperp.renderPopup as RenderPopupLike | undefined;
    if (groot.ap_value < 1) {
      if (popup) popup.trigger('no_AP');
      else deco?.FXNoAP();
      return;
    }
    if (!deco) return;
    deco.setClickable(false);
    deco.setFrame('active');
    deco.FXPulse();
    const collectFn = appModule.getApplication().remote.collectPerp;
    if (!collectFn) return;
    const path = gperp.path || '';
    const call = collectFn(path) as unknown as DoneFailChain<CollectResult>;
    call
      .done(function (data) {
        // FIXME: It would be better if data.result was in a predefined
        // state to prevent testing for both, undefined _and_ null...
        if (data.result?.result) {
          const inner = data.result.result;
          const amount = inner.cash;
          if (popup) popup.trigger('popup_close');
          groot.updateGameValues(
            data.result.game_values || {},
            data.result.levelup === true,
            data.result.missions
          );
          deco.FXBling({
            text: `$${globalThis._.toKSNum(amount)}`,
            extendClass: 'MoneyBling',
            wait: 600,
          });
          if (data.result.karma_incident) {
            const newKarma = data.result.game_values?.karma_value ?? 0;
            const karma_dec = newKarma - groot.karma_value;
            groot.makeNotifications({
              karma: { gestalt: data.result.karma_incident, dec: karma_dec },
            });
          }
          deco.FXKatsching(function () {
            gperp.renderReady?.remove();
            delete gperp.renderReady;
          });
          gperp.setState('idle', true);
        } else if (data.result?.error) {
          if (popup) popup.trigger('error');
          else deco.FXError();
          deco.FXStop();
          deco.setClickable(true);
          deco.setFrame('normal');
          console.warn('collect failed', data.result.error);
        } else {
          gperp.Error?.('The computer says NOOOO', data);
        }
      })
      .fail(function () {
        deco.FXError();
        deco.FXStop();
        deco.setClickable(true);
        deco.setFrame('normal');
      });
  }

  override markReady(): void {
    const gperp = this;
    gperp.setState('idle', false);
    gperp.setState('chargeRunning', false);
    const timer = gperp.renderTimer as { FXPuff?(): void } | undefined;
    timer?.FXPuff?.();
    const Render = getRender() as unknown as {
      DecoratorReady: new (cfg: { mode: string }) => DecoratorReadyLike;
    };
    const deco = new Render.DecoratorReady({ mode: 'money' });
    gperp.renderReady = deco;
    const rn = this.renderNode as RenderNodeLike | undefined;
    rn?.addDecorator?.(deco);
    deco.FXSproing();
    deco.on('vclick', function (e: unknown) {
      ClientPerp._stopProp(e);
      gperp.collect();
    });
  }

  Charge(): void {
    const gnode = this;
    const groot = this.groot;
    const rn = gnode.renderNode as ClientRenderNodeLike | undefined;
    if (groot.ap_value < 1) {
      if (gnode.renderPopup && (gnode.renderPopup as RenderPopupLike).open) {
        (gnode.renderPopup as RenderPopupLike).trigger('no_AP');
      } else {
        rn?.FXNoAP?.();
      }
      return;
    }
    if (gnode.states.chargeRunning || !gnode.states.idle) return;
    const chargeFn = appModule.getApplication().remote.chargePerp;
    if (!chargeFn) return;
    const path = gnode.path || '';
    const call = chargeFn(path) as unknown as DoneFailChain<ChargeResult>;
    call
      .done(function (data) {
        if (!data.result) {
          gnode.Error?.('The computer says NOOOO', data);
          return;
        }
        const r = data.result;
        if (r.error) {
          if (gnode.renderPopup && (gnode.renderPopup as RenderPopupLike).open) {
            (gnode.renderPopup as RenderPopupLike).trigger('no_AP');
          } else {
            rn?.FXAP?.();
          }
          return;
        }
        if (gnode.renderPopup) {
          (gnode.renderPopup as RenderPopupLike).trigger('popup_close');
        }
        rn?.FXDataIn?.();
        groot.updateGameValues(r.game_values || {}, r.levelup === true, r.missions);
        rn?.FXCharge?.('AP');
        gnode.markTimer({
          duration: r.duration ?? 0,
          serverTime: 0,
          serverStart: 0,
        });
      })
      .fail(function (data) {
        gnode.Error?.('The computer says NOOOO', data);
      });
  }
}
