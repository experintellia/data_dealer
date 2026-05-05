// ProjectPerp — project perp (powerup-bearing).  Manages 3 categories
// of powerup slots (UpgradePowerup / AdPowerup / TeamMemberPowerup),
// each with its own buy / sell / buy-slot flow.  Implements the same
// charge → markReady → collect lifecycle as ContactPerp / ClientPerp.
//
// The popup uses a custom slot-replacement animation
// (updatePopupGracefully) that walks the rendered popup DOM directly
// via jQuery rather than going through the popup template re-render
// path; this is preserved from the legacy implementation as-is until
// Render.js is typed (PR M-K).
//
// Extracted from scripts/Game.js's IIFE in PR 15 of issue #147.

import { getRender } from '../Render.js';
import appModule from '../app.js';
import i18n from '../i18n.js';
import { type GameNodeConfig } from './GameNode.js';
import {
  type ChargeResult,
  type DoneFailChain,
  GamePerp,
  type GameRootForPerp,
  type RenderNodeLike,
  type RenderPopupLike,
} from './GamePerp.js';
import { ProfileSet } from './ProfileSet.js';
import { mergeData } from './mergeData.js';
import { convertPowerupType, getPowerupTypeFromGestalt } from './powerupTypes.js';

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

interface ProjectRenderNodeLike extends RenderNodeLike {
  FXCharge?(): void;
  FXNoCash?(): void;
  FXDataOut?(): void;
}

/** Minimal jQuery-element surface used by updatePopupGracefully — local
 *  shim so this file doesn't depend on the global env.d.ts namespace. */
interface JQueryElemLike {
  find(selector: string): JQueryElemLike;
  removeAttr?(name: string): unknown;
  remove?(): unknown;
  append?(content: unknown): unknown;
  addClass?(cls: string): unknown;
  removeClass?(cls: string): unknown;
  replaceWith?(content: unknown): unknown;
}

interface JQueryStaticLike {
  parseHTML(html: string): unknown;
}

interface ProjectRenderPopupLike extends RenderPopupLike {
  templateData?: { cached?: boolean; loading?: boolean; data?: Record<string, unknown> };
  jdomelem?: JQueryElemLike;
  renderDataTab?(): void;
  renderPowerupSelectors?(pcat: string): void;
}

interface CollectResult {
  result?: {
    profile_set: { profiles_value: number; [k: string]: unknown };
    origin: unknown;
    collect_id: unknown;
    [k: string]: unknown;
  };
  error?: number;
  game_values?: Record<string, unknown> & { karma_value?: number };
  levelup?: boolean;
  missions?: unknown;
  karma_incident?: string;
}

interface BuyPowerupResult {
  error?: number;
  game_values?: Record<string, unknown>;
  levelup?: boolean;
  missions?: unknown;
  node?: { instance_data?: Record<string, unknown> };
}

interface PowerupRow {
  gestalt: string;
  data?: Record<string, unknown> & { title?: string };
  game_type?: string;
  instance_data?: Record<string, unknown>;
  bought?: boolean;
  slot?: number;
}

interface PowerupSlotsBucket {
  slots: (string | PowerupRow)[];
  provided: PowerupRow[];
  typelower: string;
  slots_left: number;
}

interface GameRootForProjectPerp extends GameRootForPerp {
  cash_value: number;
  ap_value: number;
  karma_value: number;
  fetchProjectPowerupData(gestalt: string, cb?: () => void): void;
  getDatabase(): { cue(ps: unknown, origin: unknown, collect_id: unknown): unknown };
}

export class ProjectPerp extends GamePerp {
  override renderType = 'Perp';
  override sticky = false;
  override popupTemplate = 'popup_project.html';

  renderReady?: DecoratorReadyLike;

  protected override get groot(): GameRootForProjectPerp {
    return this.GameRoot as unknown as GameRootForProjectPerp;
  }

  constructor(config: GameNodeConfig) {
    super(config);
    this.textNewItems = i18n.gettext('New Powerups!');
    if (this.gestalt !== undefined) {
      this.groot.IPerps[this.gestalt] = true;
    }
  }

  compileProfileSet(): void {
    const dataRec = this.data as {
      ProfileSet?: unknown;
      tokens?: ConstructorParameters<typeof ProfileSet>[1];
    };
    dataRec.ProfileSet = new ProfileSet(
      { markNew: true, lockAmountZero: true },
      dataRec.tokens ?? []
    );
  }

  override extendEventHandlers(): void {
    const gnode = this;
    gnode.on('vshiftclick', function (e: unknown) {
      ProjectPerp._stopProp(e);
      gnode.Charge();
    });
    gnode.on('vclick', function (e: unknown) {
      ProjectPerp._stopProp(e);
      gnode.openPopup();
      gnode.fetchPowerups(function () {
        gnode.compilePowerups();
        gnode.compileProfileSet();
        if (gnode.renderPopup) gnode.updatePopup();
      });
    });
    gnode.on('node_ready', function (e: unknown) {
      ProjectPerp._stopProp(e);
      gnode.markReady();
    });
  }

  fetchPowerups(cb?: () => void): void {
    if (this.gestalt) {
      this.groot.fetchProjectPowerupData(this.gestalt, cb);
    } else if (cb) {
      cb();
    }
  }

  compilePowerups(): void {
    const dataRec = (this.data || {}) as {
      provided_ads?: PowerupRow[];
      provided_upgrades?: PowerupRow[];
      provided_teammembers?: PowerupRow[];
      powerups?: PowerupRow[];
      powerups_compiled?: Record<string, PowerupSlotsBucket>;
      ad_slots?: number;
      upgrade_slots?: number;
      teammember_slots?: number;
      [key: string]: unknown;
    };

    const stampType = (rows: PowerupRow[] | undefined) => {
      rows?.forEach((powerup) => {
        const t = this.getType?.(powerup.gestalt) as
          | { type_data?: Record<string, unknown>; game_type?: string }
          | undefined;
        if (!t) {
          console.warn('Error no type_data', powerup.gestalt);
          return;
        }
        powerup.data = mergeData(t.type_data, powerup.instance_data);
        if (t.game_type !== undefined) powerup.game_type = t.game_type;
      });
    };

    if (this.data) {
      stampType(dataRec.provided_ads);
      stampType(dataRec.provided_upgrades);
      stampType(dataRec.provided_teammembers);
      dataRec.powerups?.forEach((powerup) => {
        this.removeProvidedPowerup(powerup.gestalt);
        const t = this.getType?.(powerup.gestalt) as
          | { type_data?: Record<string, unknown>; game_type?: string }
          | undefined;
        if (t) {
          powerup.data = mergeData(t.type_data, powerup.instance_data);
          if (t.game_type !== undefined) powerup.game_type = t.game_type;
        } else {
          console.warn('Error no type_data', powerup.gestalt);
        }
      });
    }

    const typeConfig = {
      UpgradePowerup: { slotsField: 'upgrade_slots', providedField: 'provided_upgrades' },
      AdPowerup: { slotsField: 'ad_slots', providedField: 'provided_ads' },
      TeamMemberPowerup: {
        slotsField: 'teammember_slots',
        providedField: 'provided_teammembers',
      },
    } as const;

    const powerups: Record<string, PowerupSlotsBucket> = {};
    (Object.keys(typeConfig) as (keyof typeof typeConfig)[]).forEach((game_type) => {
      const pcat = convertPowerupType(game_type);
      if (!pcat) return;
      const cfg = typeConfig[game_type];
      const slots_left =
        ((dataRec[`max_${pcat}_slots`] as number) ?? 0) -
        ((dataRec[`${pcat}_slots`] as number) ?? 0);
      const slotslen = (dataRec[cfg.slotsField] as number) ?? 0;
      const provided = ((dataRec[cfg.providedField] as PowerupRow[]) ?? []).filter(
        (p) => p.bought !== true
      );
      const slots: (string | PowerupRow)[] = [];
      for (let i = 0; i < slotslen; i++) slots.push('free');
      // TODO: only add locked if slots < max_length of slots
      if (slots_left > 0) slots.push('locked');
      powerups[game_type] = { slots, provided, typelower: pcat, slots_left };
    });

    (dataRec.powerups || []).forEach((p) => {
      if (!p.game_type) return;
      const bucket = powerups[p.game_type];
      if (!bucket) return;
      const slot = p.slot ?? 0;
      // test if slot is free - THIS SHOULD NOT HAPPEN!
      if (bucket.slots[slot] === 'free') bucket.slots[slot] = p;
    });
    dataRec.powerups_compiled = powerups;
  }

  removeProvidedPowerup(bgestalt: string): void {
    const dataRec = (this.data || {}) as {
      provided_ads?: PowerupRow[];
      provided_upgrades?: PowerupRow[];
      provided_teammembers?: PowerupRow[];
    };
    [dataRec.provided_ads, dataRec.provided_upgrades, dataRec.provided_teammembers].forEach(
      (rows) => {
        const found = rows?.find((r) => r.gestalt === bgestalt);
        if (found) found.bought = true;
      }
    );
  }

  addProvidedPowerup(bgestalt: string): void {
    const dataRec = (this.data || {}) as {
      provided_ads?: PowerupRow[];
      provided_upgrades?: PowerupRow[];
      provided_teammembers?: PowerupRow[];
    };
    [dataRec.provided_ads, dataRec.provided_upgrades, dataRec.provided_teammembers].forEach(
      (rows) => {
        const found = rows?.find((r) => r.gestalt === bgestalt);
        if (found) found.bought = false;
      }
    );
  }

  BuyPowerup(bgestalt?: string, bslot?: number | string): void {
    const gnode = this;
    const groot = this.groot;
    if (bgestalt === undefined || bslot === undefined) {
      gnode.Error?.('Buy powerup is missing parameters', undefined);
      return;
    }
    if (typeof bgestalt === 'string' && bgestalt.split(':')[0] === 'buyslots') {
      gnode.BuySlots(bslot, bgestalt);
      return;
    }
    const buyFn = appModule.getApplication().remote.buyPowerup;
    if (!buyFn) return;
    const path = gnode.path || '';
    const call = buyFn(path, bslot, bgestalt) as unknown as DoneFailChain<BuyPowerupResult>;
    call
      .done(function (data) {
        if (!data.result) {
          gnode._serverError(data);
          return;
        }
        const r = data.result;
        if (r.error !== undefined) {
          const buyErrors: Record<number, string> = {
            0: 'node or powerup type not found',
            1: 'slot already occupied',
            3: 'insufficient cash',
          };
          const buyDetail = r.error === 3 ? ` (cash: ${groot.cash_value})` : '';
          console.log(
            '[BuyPowerup] failed:',
            (buyErrors[r.error] || `unknown error ${r.error}`) + buyDetail,
            '| path:',
            gnode.path,
            '| slot:',
            bslot,
            '| gestalt:',
            bgestalt,
            data
          );
          if (r.error === 3) gnode.NoCash?.();
          else gnode._serverError(data);
          return;
        }
        groot.updateGameValues(r.game_values || {}, r.levelup === true, r.missions);
        gnode.data = mergeData(gnode.data, r.node?.instance_data);
        gnode.removeProvidedPowerup(bgestalt as string);
        gnode.compilePowerups();
        gnode.compileProfileSet();
        const popup = gnode.renderPopup as ProjectRenderPopupLike | undefined;
        popup?.trigger('close_powerup', [
          // NOTE: close_powerup has callback with timeout
          () => gnode.updatePopupGracefully(bslot, bgestalt as string),
        ]);
      })
      .fail(function (data) {
        const errMsg = (data as { error?: { message?: string } } | undefined)?.error?.message;
        gnode.Error?.(errMsg || 'The computer says NOOOO', data);
      });
  }

  SellPowerup(bgestalt: string, bslot: number | string): void {
    const gnode = this;
    const groot = this.groot;
    const sellFn = appModule.getApplication().remote.sellPowerup;
    if (!sellFn) return;
    const path = gnode.path || '';
    const call = sellFn(
      path,
      Number.parseInt(String(bslot), 10),
      bgestalt
    ) as unknown as DoneFailChain<BuyPowerupResult>;
    call
      .done(function (data) {
        if (!data.result) {
          gnode._serverError(data);
          return;
        }
        const r = data.result;
        if (r.error !== undefined) {
          gnode._serverError(data);
          return;
        }
        groot.updateGameValues(r.game_values || {}, r.levelup === true, r.missions);
        gnode.data = mergeData(groot.getTypeData(gnode.gestalt), r.node?.instance_data);
        gnode.addProvidedPowerup(bgestalt);
        gnode.compilePowerups();
        gnode.compileProfileSet();
        const popup = gnode.renderPopup as ProjectRenderPopupLike | undefined;
        popup?.trigger('close_powerup', [() => gnode.updatePopupGracefully(bslot, bgestalt, true)]);
      })
      .fail(function (data) {
        const errMsg = (data as { error?: { message?: string } } | undefined)?.error?.message;
        gnode.Error?.(errMsg || 'The computer says NOOOO', data);
      });
  }

  BuySlots(num: number | string, bgestalt: string): void {
    const pcat = convertPowerupType(bgestalt.split(':')[1] ?? '');
    if (!pcat) return;
    const buyNum = Number.parseInt(String(num), 10) || 1;
    const gnode = this;
    const groot = this.groot;
    const dataRec = (gnode.data || {}) as Record<string, unknown>;
    const slotKey = `${pcat}_slots`;
    const maxKey = `max_${pcat}_slots`;
    const currentSlots = (dataRec[slotKey] as number) ?? 0;
    const maxSlots = dataRec[maxKey] as number | undefined;
    if (maxSlots != null && currentSlots + buyNum > maxSlots) {
      console.log(
        `[BuySlots] blocked: max slots reached (have ${currentSlots}, max ${maxSlots}, tried to add ${buyNum})`
      );
      gnode.Error?.('Max slots reached', {});
      return;
    }
    const buyFn = appModule.getApplication().remote.buySlots;
    if (!buyFn) return;
    const path = gnode.path || '';
    const call = buyFn(path, pcat, buyNum) as unknown as DoneFailChain<BuyPowerupResult>;
    call
      .done(function (data) {
        if (!data.result) {
          gnode._serverError(data);
          return;
        }
        const r = data.result;
        if (r.error !== undefined) {
          const slotErrors: Record<number, string> = {
            0: 'node or slot type not found',
            2: 'max slots already reached',
            3: 'insufficient cash',
          };
          const slotDetails: Record<number, string> = {
            2: ` (have ${currentSlots}, max ${maxSlots}, tried to add ${buyNum})`,
            3: ` (cash: ${groot.cash_value})`,
          };
          console.log(
            '[BuySlots] failed:',
            (slotErrors[r.error] || `unknown error ${r.error}`) + (slotDetails[r.error] || ''),
            '| path:',
            gnode.path,
            '| type:',
            pcat,
            '| num:',
            buyNum,
            data
          );
          if (r.error === 2) gnode.Error?.('Max slots reached', data);
          else gnode.NoCash?.();
          return;
        }
        groot.updateGameValues(r.game_values || {}, r.levelup === true, r.missions);
        gnode.data = mergeData(gnode.data, r.node?.instance_data);
        gnode.compilePowerups();
        // FIXME: do this gracefully
        const popup = gnode.renderPopup as ProjectRenderPopupLike | undefined;
        popup?.trigger('close_powerup', [() => gnode.updatePopup()]);
      })
      .fail(function (data) {
        const errMsg = (data as { error?: { message?: string } } | undefined)?.error?.message;
        gnode.Error?.(errMsg || 'The computer says NOOOO', data);
      });
  }

  updatePopupGracefully(bslot: number | string, bgestalt: string, selling?: boolean): void {
    const pcat = getPowerupTypeFromGestalt(bgestalt);
    if (!pcat) return;
    this.updateTemplateData();
    if (this.popupTemplateData) {
      (this.popupTemplateData as { loading?: boolean }).loading = false;
    }
    const popup = this.renderPopup as ProjectRenderPopupLike | undefined;
    if (!popup) return;
    popup.renderDataTab?.();
    popup.renderPowerupSelectors?.(pcat);

    const jpop = popup.jdomelem;
    if (!jpop) return;
    const jtab = jpop.find(`.PopupTab[data-tab="${pcat}"]`);
    const dataRec = (this.data || {}) as { powerups?: PowerupRow[]; slot_background?: unknown };
    const renderView = (
      globalThis._ as unknown as { renderView(name: string, ctx: unknown): string }
    ).renderView;
    if (!selling) {
      let slot = jtab.find(`.Powerup.free[data-button-data="${bslot}"]`);
      slot.removeAttr?.('data-subpop-id');
      const powerup = dataRec.powerups?.find((p) => p.gestalt === bgestalt);
      const jpowerup = renderView('powerup.html', {
        powerup,
        slot: bslot,
        key: pcat + bslot,
        updating: true,
      });
      jtab.find(`.Subpop[data-subpop-id="${pcat}${bslot}"]`).remove?.();
      const jpowerupSubpop = renderView('subpop_powerup.html', {
        powerup,
        slot: bslot,
        key: pcat + bslot,
      });
      jtab.find('.SubpopContainer').append?.(jpowerupSubpop);
      const parsed = (globalThis.$ as unknown as JQueryStaticLike).parseHTML(jpowerup);
      slot.addClass?.('updating hide ');
      window.setTimeout(function () {
        slot.replaceWith?.(parsed);
        slot = jtab.find(`.Powerup.updating[data-button-data="${bslot}"]`);
        window.setTimeout(function () {
          slot.removeClass?.('updating');
          slot.addClass?.('taken new');
        }, 400);
      }, 400);
    } else {
      let slot = jtab.find(`.Powerup.taken[data-button-data="${bslot}"]`);
      slot.removeAttr?.('data-subpop-id');
      const jpowerup = renderView('powerup_free.html', {
        slot: bslot,
        slot_background: dataRec.slot_background,
        pkey: pcat,
        data: (this.popupTemplateData as { data?: unknown } | undefined)?.data,
        typelower: convertPowerupType(pcat),
        updating: true,
      });
      const parsed = (globalThis.$ as unknown as JQueryStaticLike).parseHTML(jpowerup);
      slot.addClass?.('updating hide');
      window.setTimeout(function () {
        slot.replaceWith?.(parsed);
        slot = jtab.find(`.Powerup.updating[data-button-data="${bslot}"]`);
        window.setTimeout(function () {
          slot.removeClass?.('updating');
          slot.addClass?.('free');
        }, 400);
      }, 400);
    }
  }

  Charge(): void {
    const gnode = this;
    const groot = this.groot;
    const rn = gnode.renderNode as ProjectRenderNodeLike | undefined;
    const dataRec = (gnode.data || {}) as { charge_cost?: number };
    if ((dataRec.charge_cost ?? 0) > groot.cash_value) {
      console.log(
        `[Charge] blocked: insufficient cash (have ${groot.cash_value}, need ${dataRec.charge_cost})`
      );
      if (gnode.renderPopup && (gnode.renderPopup as RenderPopupLike).open) {
        (gnode.renderPopup as RenderPopupLike).trigger('no_cash');
      } else {
        rn?.FXNoCash?.();
      }
      return;
    }
    if (groot.ap_value < 1) {
      console.log(`[Charge] blocked: insufficient AP (have ${groot.ap_value})`);
      gnode.NoAP?.();
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
          gnode._serverError(data);
          return;
        }
        const r = data.result;
        if (r.error !== undefined) {
          const chargeErrors: Record<number, string> = {
            1: 'insufficient AP',
            2: 'already charging',
            3: 'insufficient cash',
          };
          const chargeDetail =
            r.error === 1
              ? ` (AP: ${groot.ap_value})`
              : r.error === 3
                ? ` (cash: ${groot.cash_value}, need: ${dataRec.charge_cost})`
                : '';
          console.log(
            '[Charge] failed:',
            (chargeErrors[r.error] || `unknown error ${r.error}`) + chargeDetail,
            data
          );
          const popup = gnode.renderPopup as RenderPopupLike | undefined;
          if (r.error === 3) {
            if (popup?.open) popup.trigger('no_cash');
            else rn?.FXNoCash?.();
          } else if (r.error === 1) {
            gnode.NoAP?.();
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
              karma: { gestalt: data.result.karma_incident, karma_value: karma_dec },
            });
          }
          deco.FXBling({ text: globalThis._.toKSNum(amount), extendClass: 'ProfileBling' });
          deco.FXSuck(function () {
            (gperp.renderNode as ProjectRenderNodeLike | undefined)?.FXDataOut?.();
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
      DecoratorReady: new () => DecoratorReadyLike;
    };
    const rn = this.renderNode as RenderNodeLike | undefined;
    const deco = rn?.addDecorator?.(new Render.DecoratorReady()) as DecoratorReadyLike | undefined;
    if (!deco) return;
    this.renderReady = deco;
    deco.FXSproing();
    deco.on('vclick', function (e: unknown) {
      ProjectPerp._stopProp(e);
      gperp.collect();
    });
  }
}
