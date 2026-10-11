// Project ("Scheinfirma") popup view-model — ports `views/popup_project.html`
// and every partial it renders (profileset.html, buttons_project.html,
// powerup_free/locked/.html, subpop_powerup.html, selector_powerups.html,
// powerup_provided.html, subpop_powerup_provided.html, subpop_buyslots.html,
// values.html, values_details_powerup.html).  Issue #80 phase 2 tier 7.
//
// Same transition pattern as tokenView.ts / providedView.ts: the legacy
// templates stay on disk (still rendered by not-yet-ported popups), this
// duplicates their logic in TS.  The profileset / Charge-Collect data
// tab reuses the shared tokenView builders (identical to popup_contact).

import { crlf2html, sprintf, toKSNum, toTime } from '../dd-helpers.js';
import i18n from '../i18n.js';
import { type SpriteHelperConfig, renderSpriteHtml } from '../render/renderSpriteHelper.js';
import { convertPowerupType } from './powerupTypes.js';
import { buildValuesHtml } from './providedView.js';
import { type TokenEntry, type TokenVM, buildToken } from './tokenView.js';

const PKEYS = ['UpgradePowerup', 'AdPowerup', 'TeamMemberPowerup'] as const;
export type PowerupPkey = (typeof PKEYS)[number];

interface PowerupRowLike {
  gestalt: string;
  price?: number;
  data?: Record<string, unknown>;
}
interface PowerupBucketLike {
  slots: (string | PowerupRowLike)[];
  provided: PowerupRowLike[];
  typelower: string;
  slots_left: number;
}
interface ProjectData {
  popup_sprite?: SpriteHelperConfig;
  title?: string;
  description?: string;
  button?: string;
  upgrade_tab_text?: string;
  ad_tab_text?: string;
  teammember_tab_text?: string;
  rename_ads_tab?: boolean;
  provided_ads?: unknown[];
  powerups_compiled?: Record<string, PowerupBucketLike>;
  powerup_slot_texts?: Record<string, Record<string, string>>;
  slot_background?: SpriteHelperConfig;
  slot_cost?: number;
  charge_cost?: number;
  charge_time?: number;
  collect_amount?: number;
  collect_risk?: number;
  powerupsCached?: boolean;
  ProfileSet?: { tokens_set?: TokenEntry[] };
  [k: string]: unknown;
}

/** `values_details_powerup.html` — the subpop `.BonusWrap` block for
 *  buy/sell powerup detail cards (NOT the perp-type-gated
 *  `values_details.html`; this one always renders). */
function buildValuesDetailsPowerupHtml(data: Record<string, unknown>): string {
  const g = i18n.gettext.bind(i18n);
  let tokensHtml = '';
  const tokens = data.tokens as { type_data?: { title?: string }; amount?: number }[] | undefined;
  if (tokens?.length) {
    for (const t of tokens) {
      const amt =
        (t.amount ?? 0) < 101 ? `<span class="BonusTokenAmount"> +${t.amount}%</span>` : '';
      tokensHtml += `<div class="Bonus Profiles">${t.type_data?.title ?? ''}${amt}</div>`;
    }
    tokensHtml = `<div class="BonusTokens">${tokensHtml}</div>`;
  }
  let values = '';
  if (data.collect_amount_modifier)
    values += `<div class="Bonus Profiles">+${sprintf(g('%s Profiles'), data.collect_amount_modifier)}</div>`;
  if (data.charge_cost_modifier)
    values += `<div class="Bonus Invest">+$${toKSNum((data.charge_cost_modifier as number) ?? 0)} ${g('Invest')}</div>`;
  const riskMod = data.collect_risk_modifier as number | undefined;
  if (riskMod)
    values += `<div class="Bonus Risk ${riskMod < 0 ? 'Up' : 'Down'}"><div class="Buy Risk"></div>${toKSNum(Math.abs(riskMod))} ${g('Risk')}</div>`;
  return `<div class="BonusWrap">${tokensHtml}<div class="BonusValues">${values}</div></div>`;
}

/** One powerup slot tile: `powerup_free.html` / `powerup_locked.html`
 *  / `powerup.html`. */
export interface PowerupSlotVM {
  kind: 'free' | 'locked' | 'taken';
  slot: number;
  /** Legacy `data-subpop-id`: `Provided<pkey>` (free) / `buyslots`
   *  (locked) / `<pkey><slot>` (taken). */
  subpopId: string;
  backgroundHtml: string;
  /** Taken slots only — the perp sprite layer. */
  spriteHtml: string;
  labelHtml: string;
}

/** `subpop_powerup.html` — the per-slot sell detail card. */
export interface SellSubpopVM {
  subpopId: string;
  slot: number;
  gestalt: string;
  logoHtml: string;
  title: string;
  valuesDetailsHtml: string;
  description: string;
  sellPriceText: string;
}

/** `powerup_provided.html` — one buy-grid tile inside the Selector. */
export interface ProvidedPowerupTileVM {
  gestalt: string;
  locked: boolean;
  newBadge: boolean;
  backgroundHtml: string;
  spriteHtml: string;
  labelHtml: string;
  priceText: string;
  /** Unlocked: `values.html` rows; locked: the Requires-Level block. */
  dataHtml: string;
}

/** `subpop_powerup_provided.html` — the buy detail card opened from a
 *  provided tile inside the Selector. */
export interface ProvidedPowerupSubpopVM {
  subpopId: string;
  gestalt: string;
  logoHtml: string;
  title: string;
  valuesDetailsHtml: string;
  description: string;
  priceText: string;
  buyButtonText: string;
}

/** `subpop_buyslots.html` — the +/- buy-slots card. */
export interface BuySlotsVM {
  pkey: PowerupPkey;
  title: string;
  subtitle: string;
  description: string;
  slotCost: number;
  slotsLeft: number;
  buttonText: string;
}

export interface PowerupCategoryVM {
  pkey: PowerupPkey;
  typelower: string;
  /** `.PopupText.TabText` copy for this tab. */
  tabText: string;
  /** `.PopupMenuButton` label. */
  menuLabel: string;
  /** Shown in the menu (Ads tab is conditional). */
  menuVisible: boolean;
  /** `selector_powerups.html` header (Buy Upgrade / Buy Ad / …). */
  selectorTitle: string;
  slots: PowerupSlotVM[];
  sellSubpops: SellSubpopVM[];
  providedTiles: ProvidedPowerupTileVM[];
  providedSubpops: ProvidedPowerupSubpopVM[];
  buySlots: BuySlotsVM;
}

export interface ProjectPopupVM {
  spriteHtml: string;
  title: string;
  /** `.PopupText.TabText[data-tab="data"]`. */
  description: string;
  /** `D.cached && D.status_icons` gate — false → loading spinner. */
  cached: boolean;
  /** Data tab (profileset + Charge/Collect — identical to Contact). */
  tokens: TokenVM[];
  summaryProfiles: string;
  summaryRisk: string;
  summaryRiskUp: boolean;
  collectMode: boolean;
  chargeDisabled: boolean;
  chargeButtonText: string;
  chargeCostText: string;
  chargeTimeText: string;
  categories: PowerupCategoryVM[];
  /** Restored across the BuySlots Path-A re-mount (legacy
   *  `templateData.lastTab`). */
  initialTab: string;
}

const SELECTOR_TITLES: Record<PowerupPkey, string> = {
  UpgradePowerup: 'Buy Upgrade',
  AdPowerup: 'Buy Ad',
  TeamMemberPowerup: 'Hire Team Member',
};

function buildSlot(
  entry: string | PowerupRowLike,
  slot: number,
  pkey: PowerupPkey,
  data: ProjectData,
  wordings: Record<string, string>
): PowerupSlotVM {
  if (typeof entry === 'string') {
    if (entry === 'locked') {
      return {
        kind: 'locked',
        slot,
        subpopId: 'buyslots',
        backgroundHtml: renderSpriteHtml(
          data.slot_background as SpriteHelperConfig | undefined,
          'locked'
        ),
        spriteHtml: '',
        labelHtml: wordings.add_slots_label ?? '',
      };
    }
    return {
      kind: 'free',
      slot,
      subpopId: `Provided${pkey}`,
      backgroundHtml: renderSpriteHtml(
        data.slot_background as SpriteHelperConfig | undefined,
        'free'
      ),
      spriteHtml: '',
      labelHtml: wordings.empty_slot_label ?? '',
    };
  }
  const pd = entry.data ?? {};
  return {
    kind: 'taken',
    slot,
    subpopId: `${pkey}${slot}`,
    backgroundHtml: renderSpriteHtml(pd.slot_background as SpriteHelperConfig | undefined),
    spriteHtml: renderSpriteHtml(pd.slot_sprite as SpriteHelperConfig | undefined),
    labelHtml: crlf2html(pd.label),
  };
}

function buildSellSubpop(entry: PowerupRowLike, slot: number, pkey: PowerupPkey): SellSubpopVM {
  const pd = entry.data ?? {};
  return {
    subpopId: `${pkey}${slot}`,
    slot,
    gestalt: entry.gestalt,
    logoHtml: renderSpriteHtml(pd.popup_sprite as SpriteHelperConfig | undefined),
    title: (pd.title as string | undefined) ?? '',
    valuesDetailsHtml: buildValuesDetailsPowerupHtml(pd),
    description: (pd.description as string | undefined) ?? '',
    sellPriceText: toKSNum(Math.trunc(((pd.price as number) ?? 0) * 0.75)),
  };
}

function buildProvidedTile(powerup: PowerupRowLike, xpLevel: number): ProvidedPowerupTileVM {
  const pd = powerup.data ?? {};
  const reqLevel = (pd.required_level as number | undefined) ?? 0;
  const locked = reqLevel > 1 && xpLevel < reqLevel;
  let dataHtml = '';
  if (locked) {
    dataHtml = `<div class="Requires">${sprintf(i18n.gettext('Requires <div class="RequiresLevel">Level %s</div>'), reqLevel)}</div>`;
  } else {
    dataHtml = buildValuesHtml(pd);
  }
  return {
    gestalt: powerup.gestalt,
    locked,
    newBadge: xpLevel === reqLevel,
    backgroundHtml: renderSpriteHtml(
      pd.slot_background as SpriteHelperConfig | undefined,
      'normal'
    ),
    spriteHtml: renderSpriteHtml(pd.slot_sprite as SpriteHelperConfig | undefined),
    labelHtml: crlf2html(pd.label),
    priceText: toKSNum((powerup.price as number) ?? 0),
    dataHtml,
  };
}

function buildProvidedSubpop(
  powerup: PowerupRowLike,
  wordings: Record<string, string>
): ProvidedPowerupSubpopVM {
  const pd = powerup.data ?? {};
  return {
    subpopId: `Provided${powerup.gestalt}`,
    gestalt: powerup.gestalt,
    logoHtml: renderSpriteHtml(pd.popup_sprite as SpriteHelperConfig | undefined),
    title: (pd.title as string | undefined) ?? '',
    valuesDetailsHtml: buildValuesDetailsPowerupHtml(pd),
    description: (pd.description as string | undefined) ?? '',
    priceText: toKSNum((pd.price as number) ?? 0),
    buyButtonText: wordings.button_text ?? i18n.gettext('Buy'),
  };
}

function buildCategory(
  pkey: PowerupPkey,
  bucket: PowerupBucketLike,
  data: ProjectData,
  xpLevel: number
): PowerupCategoryVM {
  const typelower = bucket.typelower || convertPowerupType(pkey) || '';
  const wordings = data.powerup_slot_texts?.[typelower] ?? {};
  const slots = bucket.slots.map((e, i) => buildSlot(e, i, pkey, data, wordings));
  const sellSubpops: SellSubpopVM[] = [];
  bucket.slots.forEach((e, i) => {
    if (typeof e !== 'string' && e.data) sellSubpops.push(buildSellSubpop(e, i, pkey));
  });
  const provided = bucket.provided.filter((p) => p?.data);
  const tabTextKey =
    pkey === 'UpgradePowerup'
      ? 'upgrade_tab_text'
      : pkey === 'AdPowerup'
        ? 'ad_tab_text'
        : 'teammember_tab_text';
  const menuLabel =
    pkey === 'UpgradePowerup'
      ? i18n.gettext('Upgrades')
      : pkey === 'AdPowerup'
        ? data.rename_ads_tab
          ? i18n.gettext('Server')
          : i18n.gettext('Ads')
        : i18n.gettext('Team');
  return {
    pkey,
    typelower,
    tabText: (data[tabTextKey] as string | undefined) ?? '',
    menuLabel,
    menuVisible: pkey !== 'AdPowerup' || (data.provided_ads?.length ?? 0) > 0,
    selectorTitle: i18n.gettext(SELECTOR_TITLES[pkey]),
    slots,
    sellSubpops,
    providedTiles: provided.map((p) => buildProvidedTile(p, xpLevel)),
    providedSubpops: provided.map((p) => buildProvidedSubpop(p, wordings)),
    buySlots: {
      pkey,
      title: wordings.title ?? '',
      subtitle: wordings.subtitle ?? '',
      description: wordings.description ?? '',
      slotCost: (data.slot_cost as number | undefined) ?? 0,
      slotsLeft: bucket.slots_left,
      buttonText: wordings.slot_button_text ?? i18n.gettext('Buy'),
    },
  };
}

export function buildProjectPopupVM(
  data: ProjectData,
  states: { idle?: boolean; chargeRunning?: boolean } | undefined,
  xpLevel: number,
  initialTab = 'data'
): ProjectPopupVM {
  const tokens = (data.ProfileSet?.tokens_set ?? []).map((t) => buildToken(t, data));
  const collectRisk = data.collect_risk ?? 0;
  const compiled = data.powerups_compiled ?? {};
  const categories = PKEYS.filter((p) => compiled[p]).map((p) =>
    buildCategory(p, compiled[p] as PowerupBucketLike, data, xpLevel)
  );
  return {
    spriteHtml: renderSpriteHtml(data.popup_sprite),
    title: data.title ?? '',
    description: data.description ?? '',
    cached: data.powerupsCached === true,
    tokens,
    summaryProfiles: toKSNum(data.collect_amount ?? 0),
    summaryRisk: toKSNum(Math.abs(collectRisk)),
    summaryRiskUp: collectRisk < 1,
    collectMode: !states?.idle && !states?.chargeRunning,
    chargeDisabled: !states?.idle,
    chargeButtonText: data.button ?? i18n.gettext('Invest'),
    chargeCostText: toKSNum(data.charge_cost ?? 0),
    chargeTimeText: toTime(data.charge_time ?? 0),
    categories,
    initialTab,
  };
}
