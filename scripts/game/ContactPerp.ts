// ContactPerp — contact perp (collect-cycle leaf).  Implements the
// Charge → markReady → collect lifecycle: vshiftclick triggers a
// server chargePerp, which on success starts a markTimer; when the
// timer ticks down, markReady stamps a DecoratorReady on the node;
// vclick on that decorator drives the collectPerp request that pays
// out and queues the resulting profile set into the Database.
//
// Extracted from scripts/Game.js's IIFE in PR 14 of issue #147.

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

/** Decorator surface used by ContactPerp.markReady / collect. */
interface DecoratorReadyLike {
  on(ev: string, handler: (...args: unknown[]) => void): void;
  setClickable(v: boolean): void;
  setFrame(name: string): void;
  FXSproing(): void;
  FXPulse(): void;
  FXBling(opts: { text: string; extendClass?: string }): void;
  FXSuck(cb?: () => void): void;
  FXNoAP(): void;
  FXStop(): void;
  FXError(): void;
}

interface ContactRenderNodeLike extends RenderNodeLike {
  FXCharge?(): void;
  FXNoAP?(): void;
  FXDataOut?(): void;
}

interface ChargeResult {
  error?: number;
  game_values?: Record<string, unknown>;
  levelup?: boolean;
  missions?: unknown;
  duration?: number;
}

interface CollectResult {
  result?: {
    profile_set: { profiles_value: number; [k: string]: unknown };
    origin: unknown;
    collect_id: unknown;
  };
  error?: number;
  game_values?: Record<string, unknown> & { karma_value?: number };
  levelup?: boolean;
  missions?: unknown;
  karma_incident?: string;
}

interface GameRootForContactPerp extends GameRootForPerp {
  cash_value: number;
  ap_value: number;
  karma_value: number;
  getDatabase(): { cue(ps: unknown, origin: unknown, collect_id: unknown): unknown };
}

export class ContactPerp extends GamePerp {
  override renderType = 'Perp';
  override popupTemplate = 'popup_contact.html';
  override sticky = false;

  renderReady?: DecoratorReadyLike;

  protected override get groot(): GameRootForContactPerp {
    return this.GameRoot as unknown as GameRootForContactPerp;
  }

  constructor(config: GameNodeConfig) {
    super(config);
    if (this.gestalt !== undefined) {
      this.groot.IPerps[this.gestalt] = true;
    }
  }

  override extendEventHandlers(): void {
    const gnode = this;

    gnode.on('vshiftclick', function (e: unknown) {
      ContactPerp._stopProp(e);
      gnode.Charge();
    });
    gnode.on('vclick', function (e: unknown) {
      ContactPerp._stopProp(e);
      // FIXME: Prepare data move this to own function
      const dataRec = gnode.data as {
        ProfileSet?: unknown;
        tokens?: ConstructorParameters<typeof ProfileSet>[1];
      };
      dataRec.ProfileSet = new ProfileSet({ markNew: true }, dataRec.tokens ?? []);
      gnode.openPopup();
    });
    gnode.on('node_ready', function (e: unknown) {
      ContactPerp._stopProp(e);
      // FIXME result has no meaning here?! since A) event can be
      // triggered by non-socket-io b) markready takes no argument.
      gnode.markReady();
    });
  }

  Charge(): void {
    const gnode = this;
    const groot = this.groot;
    const dataRec = (gnode.data || {}) as { charge_cost?: number };
    const rn = gnode.renderNode as ContactRenderNodeLike | undefined;
    if ((dataRec.charge_cost ?? 0) > groot.cash_value) {
      if (gnode.renderPopup && (gnode.renderPopup as RenderPopupLike).open) {
        (gnode.renderPopup as RenderPopupLike).trigger('no_cash');
      } else {
        rn?.FXNoCash?.();
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
          if (r.error === 1) {
            if (gnode.renderPopup && (gnode.renderPopup as RenderPopupLike).open) {
              (gnode.renderPopup as RenderPopupLike).trigger('no_AP');
            } else {
              rn?.FXNoAP?.();
            }
          } else {
            if (gnode.renderPopup && (gnode.renderPopup as RenderPopupLike).open) {
              (gnode.renderPopup as RenderPopupLike).trigger('no_cash');
            } else {
              rn?.FXNoCash?.();
            }
          }
          return;
        }
        if (gnode.renderPopup) {
          (gnode.renderPopup as RenderPopupLike).trigger('popup_close');
        }
        groot.updateGameValues(r.game_values || {}, r.levelup === true, r.missions);
        rn?.FXCharge?.();
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

  collect(): void {
    const gperp = this;
    const groot = this.groot;
    const deco = this.renderReady;
    const popup = this.renderPopup as RenderPopupLike | undefined;
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
          const amount = inner.profile_set.profiles_value;
          if (popup) popup.trigger('popup_close');
          groot.updateGameValues(
            data.result.game_values || {},
            data.result.levelup === true,
            data.result.missions
          );
          if (data.result.karma_incident) {
            const newKarma = data.result.game_values?.karma_value ?? 0;
            const karma_dec = newKarma - groot.karma_value;
            groot.makeNotifications({
              karma: { gestalt: data.result.karma_incident, dec: karma_dec },
            });
          }
          deco.FXBling({ text: globalThis._.toKSNum(amount), extendClass: 'ProfileBling' });
          deco.FXSuck(function () {
            (gperp.renderNode as ContactRenderNodeLike | undefined)?.FXDataOut?.();
            delete gperp.renderReady;
          });
          groot.getDatabase().cue(inner.profile_set, inner.origin, inner.collect_id);
          gperp.setState('idle', true);
        } else if (data.result?.error) {
          if (popup) popup.trigger('no_AP');
          else deco.FXNoAP();
          deco.FXStop();
          deco.setClickable(true);
          deco.setFrame('normal');
          console.warn('collect failed');
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
      DecoratorReady: new () => DecoratorReadyLike;
    };
    const rn = this.renderNode as RenderNodeLike | undefined;
    const deco = rn?.addDecorator?.(new Render.DecoratorReady()) as DecoratorReadyLike | undefined;
    if (!deco) return;
    this.renderReady = deco;
    deco.FXSproing();
    deco.on('vclick', function (e: unknown) {
      ContactPerp._stopProp(e);
      gperp.collect();
    });
  }
}
