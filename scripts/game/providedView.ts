// Shared provided-perp view-model — ports the legacy partials the
// Pusher/Proxy (and later Agent/City/Project) buy popups all render:
// `client.html` / `perp.html` (grid tiles), `subpop_perp_provided.html`
// (+ `values.html` / `values_details.html`), `noitems.html`.  These
// partials stay on disk (still rendered by not-yet-ported popups);
// mirroring that, this duplicates their logic in TS during the
// transition, same pattern as tokenView.ts.

import { crlf2html, sprintf, toKSNum } from '../dd-helpers.js';
import i18n from '../i18n.js';
import { type SpriteHelperConfig, renderSpriteHtml } from '../render/renderSpriteHelper.js';
import type { ProvidedPerpRow } from './GamePerp.js';

/** Minimal groot surface the locked-tile / values-details branches
 *  need (perp.html reads DBTokens + xp_level; values_details.html
 *  gates on the gestalt's perp type). */
export interface ProvidedContext {
  xpLevel: number;
  dbTokens: Record<string, number>;
  typeOf(gestalt: string): string;
}

/** Minimal groot surface a `ProvidedContext` is built from. */
interface ProvidedContextRoot {
  xp_level: { number: number };
  DBTokens: Record<string, number>;
  getTypeFromGestalt(gestalt?: string): string;
}

/** The `{ xpLevel, dbTokens, typeOf }` literal was hand-built at every
 *  provided-grid call site (Database / GameRoot karma / CityPerp); one
 *  factory keeps them in sync. */
export function buildProvidedContext(groot: ProvidedContextRoot): ProvidedContext {
  return {
    xpLevel: groot.xp_level.number,
    dbTokens: groot.DBTokens,
    typeOf: (gestalt: string) => groot.getTypeFromGestalt(gestalt),
  };
}

type Frame = { width?: number; height?: number; pivotx?: number; pivoty?: number };

function spriteOf(v: unknown): SpriteHelperConfig | undefined {
  return v as SpriteHelperConfig | undefined;
}

function normalFrame(cfg: SpriteHelperConfig | undefined): Frame | undefined {
  return (cfg as { frameMap?: { normal?: Frame } } | undefined)?.frameMap?.normal;
}

/** RenderPerp inline style — `box` is the pivot origin (48 in
 *  client.html, 49 in perp.html).  `fm` is the perp_background frame
 *  or undefined (the slot_background fallback passes undefined so the
 *  box stays 0/0/100/100, matching perp.html's else-branch).  A
 *  non-numeric pivot stays at offset 0 (legacy `box - undefined`
 *  produced NaN → ignored CSS → 0). */
function perpStyle(fm: Frame | undefined, box: number): string {
  let offsetX = 0;
  let offsetY = 0;
  let width = 100;
  let height = 100;
  if (fm) {
    if (typeof fm.pivotx === 'number') offsetX = box - fm.pivotx;
    if (typeof fm.pivoty === 'number') offsetY = box - fm.pivoty;
    width = fm.width ?? 100;
    height = fm.height ?? 100;
  }
  return `position:absolute; top:${offsetY}px; left:${offsetX}px; width:${width}px; height:${height}px;`;
}

/** `values.html` — the `.PowerupLabelData` / `.PerpLabelData` value
 *  rows for an unlocked tile (price is rendered by the caller). */
function buildValuesHtml(data: Record<string, unknown>): string {
  const g = i18n.gettext.bind(i18n);
  const num = (v: unknown) => toKSNum((v as number) ?? 0);
  let h = '';
  const tokens = data.tokens as unknown[] | undefined;
  const consumed = data.consumed_tokens as unknown[] | undefined;
  if (tokens?.length)
    h += `<div class="Profiles"><div class="Buy Token"></div> ×${tokens.length}</div>`;
  if (consumed?.length)
    h += `<div class="Profiles consumed"><div class="Buy Token"></div> ×${consumed.length}</div>`;
  if (data.collect_amount_modifier)
    h += `<div class="Profiles">+${sprintf(g('%s Profiles'), data.collect_amount_modifier)}</div>`;
  if (data.collect_amount)
    h += `<div class="Profiles">${sprintf(g('%s Profiles'), data.collect_amount)}</div>`;
  if (data.charge_cost_modifier)
    h += `<div class="Invest">+$${num(data.charge_cost_modifier)} ${g('Invest')}</div>`;
  if (data.charge_cost)
    h += `<div class="Invest">$${num(data.charge_cost)} ${(data.button_text as string) ?? ''}</div>`;
  if (data.income_base) h += `<div class="Invest">$${num(data.income_base)} ${g('income')}</div>`;
  const risk = data.collect_risk as number | undefined;
  if (risk)
    h += `<div class="Risk ${risk < 0 ? 'Up' : 'Down'}"><div class="Buy Risk"></div>${toKSNum(Math.abs(risk))} ${g('Risk')}</div>`;
  const riskMod = data.collect_risk_modifier as number | undefined;
  if (riskMod)
    h += `<div class="Risk ${riskMod < 0 ? 'Up' : 'Down'}"><div class="Buy Risk"></div>${toKSNum(Math.abs(riskMod))} ${g('Risk')}</div>`;
  const karma = data.karma_points as number | undefined;
  if (karma)
    h += `<div class="Risk Up"><div class="Buy Risk"></div>${toKSNum(Math.abs(karma))} ${g('karma_image')}</div>`;
  if (data.max_slots)
    h += `<div class="Slots">${sprintf(g('proxy_buy can host %s projects'), data.max_slots)}</div>`;
  const pp = data.provided_perps as unknown[] | undefined;
  if (pp)
    h += `<div class="ProvidedPerps">${sprintf((data.provided_perps_text as string) ?? '', pp.length)}</div>`;
  return h;
}

/** `values_details.html` — the subpop `.BonusValues` block, only for
 *  Project/Contact/Client/Proxy gestalts. */
function buildValuesDetailsHtml(data: Record<string, unknown>, perpType: string): string {
  if (!['ProjectPerp', 'ContactPerp', 'ClientPerp', 'ProxyPerp'].includes(perpType)) return '';
  const g = i18n.gettext.bind(i18n);
  const num = (v: unknown) => toKSNum((v as number) ?? 0);
  let b = '';
  const consumed = data.consumed_tokens as unknown[] | undefined;
  const tokens = data.tokens as unknown[] | undefined;
  if (consumed?.length)
    b += `<div class="Bonus Profiles consumed"><div class="Buy Token"></div>×${consumed.length}</div>`;
  if (tokens?.length)
    b += `<div class="Bonus Profiles"><div class="Buy Token"></div>×${tokens.length}</div>`;
  if (data.collect_amount_modifier)
    b += `<div class="Bonus Profiles">+${sprintf(g('%s Profiles'), data.collect_amount_modifier)}</div>`;
  if (data.collect_amount)
    b += `<div class="Bonus Profiles">${sprintf(g('%s Profiles'), data.collect_amount)}</div>`;
  if (data.max_slots)
    b += `<div class="Bonus Slots">${sprintf(g('proxy_buy can host %s projects'), data.max_slots)}</div>`;
  if (data.charge_cost_modifier)
    b += `<div class="Bonus Invest">+$${num(data.charge_cost_modifier)} ${g('Invest')}</div>`;
  if (data.charge_cost)
    b += `<div class="Bonus Invest">$${num(data.charge_cost)} ${g('per deal')}</div>`;
  if (data.income_base)
    b += `<div class="Bonus Invest">$${num(data.income_base)} ${g('income')}</div>`;
  const risk = data.collect_risk as number | undefined;
  if (risk)
    b += `<div class="Bonus Risk ${risk < 0 ? 'Up' : 'Down'}"><div class="Buy Risk"></div>${toKSNum(Math.abs(risk))} ${g('Risk')}</div>`;
  const riskMod = data.collect_risk_modifier as number | undefined;
  if (riskMod)
    b += `<div class="Bonus Risk ${riskMod < 0 ? 'Up' : 'Down'}"><div class="Buy Risk"></div>${toKSNum(Math.abs(riskMod))} ${g('Risk')}</div>`;
  const karma = data.karma_points as number | undefined;
  if (karma)
    b += `<div class="Bonus Risk ${karma > 0 ? 'Up' : 'Down'}"><div class="Buy Risk"></div>${toKSNum(Math.abs(karma))} ${g('Risk')}</div>`;
  const pp = data.provided_perps as unknown[] | undefined;
  if (pp && data.provided_perps_text)
    b += `<div class="Bonus ProvidedPerps">${sprintf(data.provided_perps_text as string, pp.length)}</div>`;
  return `<div class="BonusWrap"><div class="BonusValues">${b}</div></div>`;
}

/** One provided-perp grid tile. `client.html` and `perp.html` share
 *  the `.PopupPerp.provided` shell but differ in the inner label
 *  classes + locked branch, captured here as resolved HTML. */
export interface ProvidedTileVM {
  /** Stable array index — legacy `data-subpop-id` is the row key. */
  key: number;
  gestalt: string;
  locked: boolean;
  /** Extra outer class (`' CityPerpSpecial'` for perp.html cities). */
  extraClass: string;
  perpStyle: string;
  /** `.RenderPerp` inner HTML (background + sprite layers). */
  renderPerpHtml: string;
  labelHtml: string;
  /** `.PowerupLabel`/`.PerpLabel` class. */
  labelClass: string;
  /** `.PowerupLabelData`/`.PerpLabelData` class. */
  labelDataClass: string;
  priceText: string;
  /** Unlocked: the values rows; locked: the Requires block. */
  dataHtml: string;
}

/** `client.html` — Pusher tiles (PowerupBackground/Label). */
function buildClientTile(perp: ProvidedPerpRow, key: number): ProvidedTileVM {
  const data = perp.data;
  const bg = spriteOf(data.perp_background);
  const locked = perp.locked === true;
  let dataHtml = '';
  if (locked) {
    const provs = (data.requiredProviders as string[] | undefined) ?? [];
    dataHtml = `<div class="Requires">${i18n.gettext('Requires')}<div class="RequiresProviders">${provs.join(', ')}</div></div>`;
  } else {
    dataHtml = buildValuesHtml(data);
  }
  return {
    key,
    gestalt: perp.gestalt,
    locked,
    extraClass: '',
    perpStyle: perpStyle(normalFrame(bg), 48),
    renderPerpHtml: `<div class="PowerupBackground">${renderSpriteHtml(bg, 'normal')}</div><div class="PowerupSprite">${renderSpriteHtml(spriteOf(data.perp_sprite))}</div>`,
    labelHtml: crlf2html(data.label),
    labelClass: 'PowerupLabel',
    labelDataClass: 'PowerupLabelData',
    priceText: toKSNum((data.price as number) ?? 0),
    dataHtml,
  };
}

/** `perp.html` — Proxy tiles (PerpBackground/Label, supertoken bg2,
 *  CityPerpSpecial, DB-token-filtered Requires + level fallback). */
function buildPerpTile(perp: ProvidedPerpRow, key: number, ctx: ProvidedContext): ProvidedTileVM {
  const data = perp.data;
  const locked = perp.locked === true;
  const isSuper = data.is_supertoken === true;
  // Mirror perp.html exactly: the RenderPerp box (pivot offset + size)
  // is derived ONLY from `perp_background`'s frame.  When there's no
  // `perp_background` frame the legacy code fell to the
  // `else if (slot_background)` branch, which rendered the
  // slot_background sprite but left offset/size at 0/0/100/100 —
  // it did *not* pivot-centre by the slot frame (whose pivot is 0,0,
  // which would shove the tile +49px and bleed it across neighbours).
  let bg = spriteOf(data.perp_background);
  if (bg && isSuper) bg = spriteOf(data.perp_background2);
  const styleFrame = normalFrame(bg);
  if (!styleFrame && data.slot_background) bg = spriteOf(data.slot_background);
  let dataHtml = '';
  if (locked) {
    const reqTokens = data.requiredTokens as
      | { gestalt: string; type_data?: { title?: string } }[]
      | undefined;
    const reqLevel = (data.required_level as number | undefined) ?? 0;
    if (reqTokens?.length && reqLevel <= ctx.xpLevel) {
      const filtered = reqTokens.filter(
        (t) => !Object.prototype.hasOwnProperty.call(ctx.dbTokens, t.gestalt)
      );
      const titles = filtered.map((t) => t.type_data?.title ?? '');
      dataHtml = `<div class="Requires">${i18n.gettext('Requires')}<div class="RequiresProviders">${titles.join(',<br />')}</div></div>`;
    } else {
      dataHtml = `<div class="Requires">${sprintf(i18n.gettext('Requires <div class="RequiresLevel">Level %s</div>'), reqLevel)}</div>`;
    }
  } else {
    dataHtml = buildValuesHtml(data);
  }
  return {
    key,
    gestalt: perp.gestalt,
    locked,
    extraClass: data.is_city ? ' CityPerpSpecial' : '',
    perpStyle: perpStyle(styleFrame, 49),
    renderPerpHtml: `<div class="PerpBackground">${renderSpriteHtml(bg, 'normal')}</div><div class="PerpSprite">${renderSpriteHtml(spriteOf(data.perp_sprite ?? data.slot_sprite))}</div>`,
    labelHtml: crlf2html(data.label),
    labelClass: 'PerpLabel',
    labelDataClass: 'PerpLabelData',
    priceText: toKSNum((data.price as number) ?? 0),
    dataHtml,
  };
}

/** `agent.html` — CityPerp Agents-tab tile (PowerupBackground/Label,
 *  box pivot 49, plain level-Requires locked branch). */
function buildAgentTile(perp: ProvidedPerpRow, key: number): ProvidedTileVM {
  const data = perp.data;
  const bg = spriteOf(data.perp_background);
  const locked = perp.locked === true;
  const reqLevel = (data.required_level as number | undefined) ?? 0;
  const dataHtml = locked
    ? `<div class="Requires">${sprintf(i18n.gettext('Requires <div class="RequiresLevel">Level %s</div>'), reqLevel)}</div>`
    : buildValuesHtml(data);
  return {
    key,
    gestalt: perp.gestalt,
    locked,
    extraClass: '',
    perpStyle: perpStyle(normalFrame(bg), 49),
    renderPerpHtml: `<div class="PowerupBackground">${renderSpriteHtml(bg, 'normal')}</div><div class="PowerupSprite">${renderSpriteHtml(spriteOf(data.perp_sprite))}</div>`,
    labelHtml: crlf2html(data.label),
    labelClass: 'PowerupLabel',
    labelDataClass: 'PowerupLabelData',
    priceText: toKSNum((data.price as number) ?? 0),
    dataHtml,
  };
}

/** `pusher.html` — CityPerp Pushers-tab tile (PowerupBackground/Label,
 *  box pivot 47, `Requires … and<br/>` locked branch).
 *
 *  A pusher unlocks only once **all** of its `required_providers` are
 *  owned — `_isProvidable` (LocalEngine) ANDs the list, and the
 *  ruleset-query tests assert "buyable once all required_providers are
 *  owned".  The locked-tile copy therefore lists them joined with "and",
 *  not the old "Requires either … or" (which wrongly implied any single
 *  one would suffice). */
function buildPusherTile(perp: ProvidedPerpRow, key: number): ProvidedTileVM {
  const data = perp.data;
  const bg = spriteOf(data.perp_background);
  const locked = perp.locked === true;
  let dataHtml: string;
  if (locked) {
    const provs = (data.requiredProviders as string[] | undefined) ?? [];
    const inner = provs
      .map((v, k) => (k + 1 < provs.length ? `${v},<br />` : `${i18n.gettext('and<br/>')}${v}`))
      .join('');
    dataHtml = `<div class="Requires">${i18n.gettext('Requires')}<div class="RequiresProviders">${inner}</div></div>`;
  } else {
    dataHtml = buildValuesHtml(data);
  }
  return {
    key,
    gestalt: perp.gestalt,
    locked,
    extraClass: '',
    perpStyle: perpStyle(normalFrame(bg), 47),
    renderPerpHtml: `<div class="PowerupBackground">${renderSpriteHtml(bg, 'normal')}</div><div class="PowerupSprite">${renderSpriteHtml(spriteOf(data.perp_sprite))}</div>`,
    labelHtml: crlf2html(data.label),
    labelClass: 'PowerupLabel',
    labelDataClass: 'PowerupLabelData',
    priceText: toKSNum((data.price as number) ?? 0),
    dataHtml,
  };
}

/** `subpop_perp_provided.html` — the buy detail subpop. */
export interface ProvidedSubpopVM {
  key: number;
  gestalt: string;
  logoHtml: string;
  title: string;
  valuesDetailsHtml: string;
  description: string;
  priceText: string;
  buyButtonText: string;
}

function buildProvidedSubpop(
  perp: ProvidedPerpRow,
  key: number,
  ctx: ProvidedContext
): ProvidedSubpopVM {
  const data = perp.data;
  return {
    key,
    gestalt: perp.gestalt,
    logoHtml: renderSpriteHtml(spriteOf(data.popup_sprite)),
    title: (data.title as string | undefined) ?? '',
    valuesDetailsHtml: buildValuesDetailsHtml(data, ctx.typeOf(perp.gestalt)),
    description: (data.description as string | undefined) ?? '',
    priceText: toKSNum((data.price as number) ?? 0),
    buyButtonText: (data.buy_button_text as string | undefined) ?? i18n.gettext('Buy'),
  };
}

/** The Pusher/Proxy buy popup — same shell (header, subpop container,
 *  paged provided-perp selector, MainButton); they differ only in
 *  subtitle, selector title, tile kind, button-disabled, and the
 *  empty-state copy, all resolved into this one VM. */
export interface ProvidedPopupVM {
  spriteHtml: string;
  /** When set, the header logo is a `.MainSpritesPopup.<class>` chip
   *  (legacy `popup.html` / `popup_karma.html` `mainsprites_class`
   *  branch) instead of `spriteHtml`. */
  mainspritesClass?: string;
  title: string;
  subtitle: string;
  description: string;
  /** Empty string → the `.SubpopHeader` title bar is omitted (legacy
   *  `popup.html` only renders it when `data.selectortitle` is set;
   *  `popup_karma.html` always renders it because of `karmaChip`). */
  selectorTitle: string;
  /** `popup_karma.html` SubpopHeader Risk chip (karma value).  When
   *  set, the `.SubpopHeader` renders even with an empty
   *  `selectorTitle`, with this chip before the title. */
  karmaChip?: { up: boolean; text: string };
  tiles: ProvidedTileVM[];
  subpops: ProvidedSubpopVM[];
  loading: boolean;
  noItemsText: string;
  loadingText: string;
  buttonText: string;
  buttonDisabled: boolean;
}

/** Build the tile + subpop VMs for a provided-perp grid.  `kind`
 *  selects the legacy grid partial: `client` (Pusher) / `perp`
 *  (Proxy / City Bogus+City tabs) / `agent` (City Agents tab) /
 *  `pusher` (City Pushers tab). */
export function buildProvided(
  rows: ProvidedPerpRow[],
  kind: 'client' | 'perp' | 'agent' | 'pusher',
  ctx: ProvidedContext
): { tiles: ProvidedTileVM[]; subpops: ProvidedSubpopVM[] } {
  const build = (p: ProvidedPerpRow, i: number): ProvidedTileVM => {
    switch (kind) {
      case 'client':
        return buildClientTile(p, i);
      case 'agent':
        return buildAgentTile(p, i);
      case 'pusher':
        return buildPusherTile(p, i);
      default:
        return buildPerpTile(p, i, ctx);
    }
  };
  const tiles = rows.map(build);
  const subpops = rows.map((p, i) => buildProvidedSubpop(p, i, ctx));
  return { tiles, subpops };
}
