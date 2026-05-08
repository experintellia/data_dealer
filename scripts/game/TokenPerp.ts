// TokenPerp — token perp.  Tokens are leaf data nodes; their amount
// scales with `groot.profiles_value` (so DB profiles → token absolute
// amounts).  Tokens with `contained_tokens` are upgradeable: charge
// pulls in tokens from contained children, collect bumps the token's
// own amount and notifies the Database.  setAmount mutates the
// groot-side DBTokens / DBTokensAbsolute mirrors to keep DB queries
// cheap (the Database reads them in getCityOriginAmounts /
// getDBFactorNormalized).
//
// Extracted from scripts/Game.js's IIFE in PR 16 of issue #147.

import { getRender } from '../Render.js';
import appModule from '../app.js';
import { type GameNodeConfig, getByGestalt } from './GameNode.js';
import {
  type ChargeResult,
  type DoneFailChain,
  GamePerp,
  type GameRootForPerp,
  type RenderNodeLike,
  type RenderPopupLike,
} from './GamePerp.js';
import { ProfileSet } from './ProfileSet.js';

interface DecoratorAmountLike {
  setAmount(n: number): void;
}

interface DecoratorGearLike {
  setFrame(name: string): void;
  FXSproing(): void;
  remove(): void;
}

interface DecoratorReadyLike {
  on(ev: string, handler: (...args: unknown[]) => void): void;
  setClickable(v: boolean): void;
  setFrame(name: string): void;
  FXSproing(): void;
  FXPulse(): void;
  FXSuck(cb?: () => void): void;
  FXNoAP(): void;
  FXStop(): void;
  FXError(): void;
}

interface CableLike {
  FXDataIn(cb?: () => void): void;
}

interface TokenRenderNodeLike extends RenderNodeLike {
  DecoratorAmount?: DecoratorAmountLike;
  DecoratorGear?: DecoratorGearLike;
  FXCharge?(arg?: string): void;
  FXNoAP?(): void;
  FXAP?(): void;
  FXSpinner?(opts: { text: string; duration: number }, cb?: () => void): void;
  cableAnimatedRemove?(target: unknown): void;
  cableAnimatedTo?(target: unknown, opts: Record<string, unknown>, cb?: () => void): CableLike;
  cableTo?(target: unknown, opts: Record<string, unknown>): void;
}

interface CollectResult {
  result?: { token_upgraded_amount: number; [k: string]: unknown };
  error?: number;
  game_values?: Record<string, unknown>;
  levelup?: boolean;
  missions?: unknown;
}

interface NodeReadyPayload {
  last_upgrade_data?: unknown;
}

interface GameRootForTokenPerp extends GameRootForPerp {
  ap_value: number;
  profiles_value: number;
  DBTokens: Record<string, number>;
  DBTokensAbsolute: Record<string, number>;
  getDatabase(): {
    compileSuperTokens(): void;
    checkNotifications(): void;
  };
  updateGears(): void;
}

interface TokenSetEntry {
  locked?: boolean;
  diffAmount?: number;
  [k: string]: unknown;
}

export class TokenPerp extends GamePerp {
  override renderType = 'Perp';
  // `'in'` here, `'inout'` on SupertokenPerp.  Legacy Game.js had a
  // copy-paste typo at line 2509 that swapped these (the SuperToken
  // prototype-defaults block assigned `cableType = 'inout'` to
  // *TokenPerp* and left SupertokenPerp inheriting GamePerp's
  // `'in'` default).  PR #229 swaps to the intended values; see
  // issue #191 for context.
  override cableType = 'in' as const;
  override popupTemplate = 'popup_token.html';

  amount?: number;
  renderReady?: DecoratorReadyLike;

  protected override get groot(): GameRootForTokenPerp {
    return this.GameRoot as unknown as GameRootForTokenPerp;
  }

  constructor(config: GameNodeConfig) {
    super(config);
    const data = (config?.data ?? {}) as { amount?: number };
    this.setAmount(typeof data.amount === 'number' ? data.amount : 0);
  }

  setAmount(amount: number): void {
    const groot = this.groot;
    const dataRec = (this.data ||= {}) as Record<string, unknown> & {
      amount?: number;
      absoluteAmount?: number;
      previousAbsoluteAmount?: number;
      absoluteInc?: number;
      absoluteIncPerc?: number;
    };
    const absoluteAmount = (groot.profiles_value * amount) / 100;
    // FIXME: previousAbsoluteAmount is only correct for newly-set tokens;
    // game-load path leaves it at 0.
    dataRec.previousAbsoluteAmount = dataRec.absoluteAmount ?? 0;
    dataRec.absoluteAmount = absoluteAmount;
    this.amount = amount;
    dataRec.amount = amount;
    dataRec.absoluteInc = absoluteAmount - (dataRec.previousAbsoluteAmount ?? 0);
    dataRec.absoluteIncPerc =
      absoluteAmount === 0 ? 0 : (100 / absoluteAmount) * dataRec.absoluteInc;
    if (this.gestalt !== undefined) {
      groot.DBTokens[this.gestalt] = amount;
      groot.DBTokensAbsolute[this.gestalt] = absoluteAmount;
    }
  }

  updateRenderAmount(): void {
    const dataRec = (this.data || {}) as { amount?: number };
    const rn = this.renderNode as TokenRenderNodeLike | undefined;
    rn?.DecoratorAmount?.setAmount(dataRec.amount ?? 0);
  }

  updateGear(): void {
    const dataRec = (this.data || {}) as { contained_tokens?: unknown[] };
    const rn = this.renderNode as TokenRenderNodeLike | undefined;
    if (!dataRec.contained_tokens?.length || !rn) return;
    this.makeProfileSet();
    const av = this.getUpgradeAverage();
    const frame = av > 0 ? 'normal' : 'inactive';
    if (!rn.DecoratorGear) {
      const Render = getRender() as unknown as { DecoratorGear: new () => DecoratorGearLike };
      rn.addDecorator?.(new Render.DecoratorGear());
    }
    rn.DecoratorGear?.setFrame(frame);
  }

  getUpgradeAverage(): number {
    this.setState('zeroresult', true);
    const dataRec = (this.data || {}) as {
      ProfileSet?: { tokens_set?: TokenSetEntry[] };
      upgradeAverage?: number;
    };
    if (!dataRec.ProfileSet) return 0;
    const amounts: number[] = [];
    (dataRec.ProfileSet.tokens_set ?? []).forEach((token) => {
      if (!token.locked && token.diffAmount !== undefined) {
        amounts.push(token.diffAmount);
      }
    });
    const len = amounts.length || 1;
    const sum = amounts.reduce((memo, num) => memo + num, 0);
    const avg = Math.round((sum / len) * 100) / 100;
    dataRec.upgradeAverage = avg;
    if (avg > 0) this.setState('zeroresult', false);
    return avg;
  }

  override extendRender(): void {
    const Render = getRender() as unknown as {
      DecoratorLabel: new (cfg: unknown) => unknown;
      DecoratorAmount: new (cfg: unknown) => unknown;
      DecoratorGear: new () => DecoratorGearLike;
    };
    const render = this.renderData || {};
    const node = this.renderNode as TokenRenderNodeLike | undefined;
    if (!node) return;
    node.sticky = this.sticky;

    if (render.config?.label) {
      node.addDecorator?.(
        new Render.DecoratorLabel({
          text: render.config.label,
          extendClass: this.labelClass,
          offsetToParent: { x: 0, y: 6 },
        })
      );
    }
    const dataRec = (this.data || {}) as {
      amount?: number;
      contained_tokens?: { gestalt: string }[];
    };
    const amount = dataRec.amount ?? 0;
    node.addDecorator?.(new Render.DecoratorAmount({ amount, decoratedNode: node }));

    if (dataRec.contained_tokens?.length) {
      node.addDecorator?.(new Render.DecoratorGear());
      this.updateGear();
    }

    if (this._loadReady) {
      this.markReady();
      delete this._loadReady;
    } else if (this._loadTimer) {
      this.markTimer(this._loadTimer);
      delete this._loadTimer;
    }

    if (this.states.idle === false && dataRec.contained_tokens?.length) {
      dataRec.contained_tokens.forEach((t) => {
        const ct = getByGestalt(t.gestalt);
        const ctRn = ct?.renderNode as RenderNodeLike | undefined;
        if (ct && ctRn) {
          node.cableTo?.(ctRn, {
            cableMaxLength: 1920,
            mode: 'in',
            noWobble: true,
          });
        }
      });
    }
  }

  makeProfileSet(): void {
    const dataRec = (this.data || {}) as {
      ProfileSet?: unknown;
      contained_tokens?: ConstructorParameters<typeof ProfileSet>[1];
      last_upgrade_values?: ConstructorParameters<typeof ProfileSet>[0]['lastUpgradeValues'];
    };
    dataRec.ProfileSet = new ProfileSet(
      {
        lockNotInDB: true,
        DBAmounts: true,
        markUpgradeValues: true,
        ...(dataRec.last_upgrade_values ? { lastUpgradeValues: dataRec.last_upgrade_values } : {}),
      },
      dataRec.contained_tokens ?? []
    );
  }

  override extendEventHandlers(): void {
    const gnode = this;

    gnode.on('vshiftclick', function (e: unknown) {
      TokenPerp._stopProp(e);
      const dataRec = (gnode.data || {}) as { contained_tokens?: unknown[] };
      if (dataRec.contained_tokens?.length) gnode.Charge();
    });

    gnode.on('vclick', function (e: unknown) {
      TokenPerp._stopProp(e);
      const dataRec = (gnode.data || {}) as { contained_tokens?: unknown[] };
      if (dataRec.contained_tokens) gnode.makeProfileSet();
      gnode.openPopup();
    });

    gnode.on('node_ready', function (e: unknown, result: unknown) {
      TokenPerp._stopProp(e);
      const dataRec = gnode.data as { last_upgrade_values?: unknown };
      const payload = (result || {}) as NodeReadyPayload;
      dataRec.last_upgrade_values = payload.last_upgrade_data;
      gnode.markReady();
    });
  }

  Charge(): void {
    const gnode = this;
    const groot = this.groot;
    const rnode = gnode.renderNode as TokenRenderNodeLike | undefined;
    if (groot.ap_value < 1) {
      const popup = gnode.renderPopup as RenderPopupLike | undefined;
      if (popup?.open) popup.trigger('no_AP');
      else rnode?.FXNoAP?.();
      return;
    }
    if (gnode.states.chargeRunning || !gnode.states.idle || gnode.states.zeroresult) return;
    const chargeFn = appModule.getApplication().remote.chargePerp;
    if (!chargeFn) return;
    const path = gnode.path || '';
    const call = chargeFn(path) as unknown as DoneFailChain<ChargeResult>;
    call
      .done(function (data) {
        if (!data.result) {
          gnode._serverError(data);
          return;
        }
        const r = data.result;
        if (r.error) {
          const popup = gnode.renderPopup as RenderPopupLike | undefined;
          if (popup?.open) popup.trigger('no_AP');
          else rnode?.FXAP?.();
          return;
        }
        const popup = gnode.renderPopup as RenderPopupLike | undefined;
        popup?.trigger('popup_close');
        groot.updateGameValues(r.game_values || {}, r.levelup === true, r.missions);
        rnode?.FXCharge?.('AP');
        rnode?.DecoratorGear?.remove();
        gnode.markTimer({
          duration: r.duration ?? 0,
          serverTime: 0,
          serverStart: 0,
        });

        let wait = 300;
        const dataRec = (gnode.data || {}) as { contained_tokens?: { gestalt: string }[] };
        (dataRec.contained_tokens || []).forEach((t) => {
          const ct = getByGestalt(t.gestalt);
          const ctRn = ct?.renderNode as RenderNodeLike | undefined;
          if (ct && ctRn) {
            const w = wait;
            window.setTimeout(function () {
              const cable = rnode?.cableAnimatedTo?.(ctRn, {
                cableMaxLength: 1920,
                mode: 'in',
                noWobble: true,
              });
              window.setTimeout(function () {
                cable?.FXDataIn(function () {
                  rnode?.FXBounce?.();
                });
              }, w + 400);
            }, w);
            wait += 150;
          }
        });
      })
      .fail(function (data) {
        gnode._serverError(data);
      });
  }

  collect(): void {
    const gperp = this;
    const groot = this.groot;
    const deco = this.renderReady;
    if (!deco) return;
    if (groot.ap_value < 1) {
      deco.FXNoAP();
      return;
    }
    const popup = gperp.renderPopup as RenderPopupLike | undefined;
    deco.setClickable(false);
    deco.setFrame('active');
    deco.FXPulse();
    const collectFn = appModule.getApplication().remote.collectPerp;
    if (!collectFn) return;
    const path = gperp.path || '';
    const call = collectFn(path) as unknown as DoneFailChain<CollectResult>;
    call
      .done(function (data) {
        if (data.result?.result) {
          if (popup) popup.trigger('popup_close');
          // FIXME: compile for checkNotifications
          groot.getDatabase().compileSuperTokens();
          gperp.setAmount(data.result.result.token_upgraded_amount);
          groot.updateGameValues(
            data.result.game_values || {},
            data.result.levelup === true,
            data.result.missions
          );
          deco.FXSuck(function () {
            const Render = getRender() as unknown as {
              DecoratorGear: new () => DecoratorGearLike;
            };
            const rn = gperp.renderNode as TokenRenderNodeLike | undefined;
            rn?.addDecorator?.(new Render.DecoratorGear());
            gperp.updateGear();
            rn?.DecoratorGear?.FXSproing();
            delete gperp.renderReady;
            window.setTimeout(function () {
              groot.getDatabase().checkNotifications();
              groot.updateGears();
            }, 2000);
          });

          let wait = 0;
          const dataRec = (gperp.data || {}) as {
            contained_tokens?: { gestalt: string }[];
            absoluteInc?: number;
          };
          // FX WITH CABLES — animate cable removal to each contained token.
          (dataRec.contained_tokens || []).forEach((t) => {
            const ct = getByGestalt(t.gestalt);
            const ctRn = ct?.renderNode as RenderNodeLike | undefined;
            if (ct && ctRn) {
              const w = wait;
              window.setTimeout(function () {
                (gperp.renderNode as TokenRenderNodeLike | undefined)?.cableAnimatedRemove?.(ctRn);
              }, w + 200);
              wait += 200;
            }
          });
          // FIXME when previous was 0 there's something wrong here...
          const text = `+${globalThis._.toKSNum(dataRec.absoluteInc ?? 0)}`;
          window.setTimeout(function () {
            (gperp.renderNode as TokenRenderNodeLike | undefined)?.FXSpinner?.(
              { text, duration: wait },
              function () {
                gperp.updateRenderAmount();
              }
            );
          }, 800);
          // FIXME Merge to DB
          gperp.setState('idle', true);
        } else if (data.result?.error) {
          deco.FXNoAP();
          deco.FXStop();
          deco.setClickable(true);
          deco.setFrame('normal');
        } else {
          gperp._serverError(data);
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
    const rn = this.renderNode as RenderNodeLike | undefined;
    const deco = rn?.addDecorator?.(new Render.DecoratorReady({ mode: 'gear' })) as
      | DecoratorReadyLike
      | undefined;
    if (!deco) return;
    this.renderReady = deco;
    deco.FXSproing();
    deco.on('vclick', function (e: unknown) {
      TokenPerp._stopProp(e);
      gperp.collect();
    });
  }
}
