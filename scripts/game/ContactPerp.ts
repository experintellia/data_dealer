// ContactPerp — contact perp (collect-cycle leaf).  Implements the
// Charge → markReady → collect lifecycle: vshiftclick triggers a
// server chargePerp, which on success starts a markTimer; when the
// timer ticks down, markReady stamps a DecoratorReady on the node;
// vclick on that decorator drives the collectPerp request that pays
// out and queues the resulting profile set into the Database.
//
// Extracted from scripts/Game.js's IIFE in PR 14 of issue #147.

import { type RenderApi, getRender } from '../Render.js';
import appModule from '../app.js';
import { ContactPopup } from '../components/popups/ContactPopup.js';
import { toKSNum } from '../dd-helpers.js';
import { type GameNodeConfig } from './GameNode.js';
import {
  GamePerp,
  type GameRootForPerp,
  type RenderNodeLike,
  type RenderPopupLike,
} from './GamePerp.js';
import { ProfileSet } from './ProfileSet.js';
import { buildContactPopupVM } from './contactView.js';

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

interface GameRootForContactPerp extends GameRootForPerp {
  cash_value: number;
  ap_value: number;
  karma_value: number;
  getDatabase(): { cue(ps: unknown, origin: unknown, collect_id: unknown): unknown };
}

export class ContactPerp extends GamePerp {
  override renderType = 'Perp';
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

  override openPopup(): RenderPopupLike {
    const vm = buildContactPopupVM(
      (this.data ?? {}) as Parameters<typeof buildContactPopupVM>[0],
      this.states
    );
    const handle = this.openPreactPopup(ContactPopup, { vm });
    return handle as RenderPopupLike;
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
    const call = chargeFn(path);
    call
      .done(function (data) {
        if (!data.result) {
          gnode._serverError(data);
          return;
        }
        const r = data.result;
        if (r.error) {
          if (r.error === 1) {
            groot.reconcileAP(r);
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
        gnode._serverError(data);
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
    const call = collectFn(path);
    call
      .done(function (data) {
        // FIXME: It would be better if data.result was in a predefined
        // state to prevent testing for both, undefined _and_ null...
        if (data.result?.result) {
          const inner = data.result.result;
          if (!inner.profile_set) return;
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
          deco.FXBling({ text: toKSNum(amount), extendClass: 'ProfileBling' });
          deco.FXSuck(function () {
            (gperp.renderNode as ContactRenderNodeLike | undefined)?.FXDataOut?.();
            delete gperp.renderReady;
          });
          groot.getDatabase().cue(inner.profile_set, inner.origin, inner.collect_id);
          gperp.setState('idle', true);
        } else if (data.result?.error) {
          groot.reconcileAP(data.result);
          if (popup) popup.trigger('no_AP');
          else deco.FXNoAP();
          deco.FXStop();
          deco.setClickable(true);
          deco.setFrame('normal');
          console.warn('collect failed');
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
    // Idempotent: a duplicate node_ready must not stack a 2nd DecoratorReady.
    if (gperp.renderReady) return;
    gperp.setState('idle', false);
    gperp.setState('chargeRunning', false);
    const timer = gperp.renderTimer as { FXPuff?(): void } | undefined;
    timer?.FXPuff?.();
    const Render = getRender() as Pick<RenderApi, 'DecoratorReady'>;
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
