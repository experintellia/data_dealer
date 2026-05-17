// Shared token view-model — ports the legacy partials that popup_contact
// / popup_client (and later popup_project) all render: `token.html`,
// `token_consumed.html`, `subpop_token.html`.  The legacy templates
// share these partials; mirroring that, the Contact (tier 5a) and
// Client (tier 5b) VMs both build from here instead of duplicating the
// sprite-pivot math + subpop logic.

import { crlf2html, sprintf, toKSNum } from '../dd-helpers.js';
import i18n from '../i18n.js';
import { renderAmountHtml } from '../render/RenderTopLevelUI.js';
import { type SpriteHelperConfig, renderSpriteHtml } from '../render/renderSpriteHelper.js';

export interface TokenEntry {
  gestalt: string;
  amount?: number;
  collect_amount?: number;
  database_amount?: number;
  database_absoluteAmount?: number;
  diffAmount?: number;
  diffAbsoluteAmount?: number;
  doneAmount?: number;
  new?: boolean;
  locked?: boolean;
  data?: Record<string, unknown>;
}

/** Contact-level fields the subpop reads (legacy `subpop_token.html`
 *  only ever consults `D.collect_amount`).  An object rather than a
 *  bare positional so further threaded fields don't grow the arity. */
export interface TokenContext {
  collect_amount?: number;
}

/** One token tile (`token.html` / `token_consumed.html`) + its detail
 *  subpop (`subpop_token.html`). */
export interface TokenVM {
  gestalt: string;
  locked: boolean;
  /** Absolute-positioned `.PopupTokenPerp` inline style. */
  perpStyle: string;
  /** Stacked sprite HTML, baked as the direct innerHTML of
   *  `.PopupTokenPerp` (ribbon included, no wrapper span) so it matches
   *  the still-live shared templates under shared CSS. */
  spriteHtml: string;
  labelHtml: string;
  subpop: {
    logoHtml: string;
    title: string;
    subTitleHtml: string;
    description: string;
  };
}

const SPRITE_BOX = 38;

function spriteOf(v: unknown): SpriteHelperConfig | undefined {
  return v as SpriteHelperConfig | undefined;
}

/** Background config + the absolute `.PopupTokenPerp` style — the
 *  pivot math is identical in `token.html` and `token_consumed.html`. */
function perpBg(data: Record<string, unknown>): {
  bgCfg: SpriteHelperConfig | undefined;
  perpStyle: string;
} {
  const isSuper = data.is_supertoken === true;
  const bgCfg = spriteOf(isSuper ? data.perp_background2 : data.perp_background);
  const fm = (bgCfg as { frameMap?: { normal?: Record<string, number> } } | undefined)?.frameMap
    ?.normal;
  let offsetX = 0;
  let offsetY = 0;
  let width = 0;
  let height = 0;
  if (fm) {
    offsetX = SPRITE_BOX - (fm.pivotx ?? 0);
    offsetY = SPRITE_BOX - (fm.pivoty ?? 0);
    width = fm.width ?? 0;
    height = fm.height ?? 0;
  }
  return {
    bgCfg,
    perpStyle: `position:absolute; top:${offsetY}px; left:${offsetX}px; width:${width}px; height:${height}px;`,
  };
}

/** subpop_token.html: `collect_amount = D.collect_amount ||
 *  token.collect_amount`; gate is `if (collect_amount)` then `else if
 *  (database_amount)` — not gated on the text. */
function buildSubpop(token: TokenEntry, ctx: TokenContext): TokenVM['subpop'] {
  const data = token.data ?? {};
  const collectAmount = ctx.collect_amount || token.collect_amount;
  const dbAmount = token.database_amount;
  const findingsText = (data.findings_text ?? data.stats_text) as string | undefined;
  let subTitleHtml = '';
  if (collectAmount) {
    subTitleHtml = sprintf(
      findingsText ?? '',
      toKSNum(collectAmount * ((token.amount ?? 0) / 100))
    );
  } else if (dbAmount) {
    subTitleHtml = sprintf(
      (data.knowledge_text as string | undefined) ?? '',
      toKSNum(token.database_absoluteAmount ?? 0)
    );
  }
  return {
    logoHtml: renderSpriteHtml(spriteOf(data.popup_sprite)),
    title: (data.title as string | undefined) ?? '',
    subTitleHtml,
    description: (data.description as string | undefined) ?? '',
  };
}

/** `token.html` — provided/contact tokens: "New!" ribbon, background,
 *  perp sprite, RenderAmount (database / diff / amount). */
export function buildToken(token: TokenEntry, ctx: TokenContext): TokenVM {
  const data = token.data ?? {};
  const { bgCfg, perpStyle } = perpBg(data);
  let spriteHtml =
    token.new === true && token.locked !== true
      ? `<div class="new">${i18n.gettext('New!')}</div>`
      : '';
  spriteHtml += renderSpriteHtml(bgCfg);
  spriteHtml += renderSpriteHtml(spriteOf(data.perp_sprite));
  if (token.database_amount && !token.locked && token.diffAmount === undefined) {
    spriteHtml += renderAmountHtml(token.database_amount);
  } else if (token.diffAmount !== undefined) {
    spriteHtml += renderAmountHtml(
      token.doneAmount,
      'normal',
      token.diffAmount,
      token.diffAbsoluteAmount
    );
  } else if (token.amount && !token.locked) {
    spriteHtml += renderAmountHtml(token.amount);
  }
  return {
    gestalt: token.gestalt,
    locked: token.locked === true,
    perpStyle,
    spriteHtml,
    labelHtml: crlf2html(data.label),
    subpop: buildSubpop(token, ctx),
  };
}

/** `token_consumed.html` — consumed tokens: no ribbon, background +
 *  RenderAmount rendered with the `consumed` frame, amount only when a
 *  database_amount exists. */
export function buildConsumedToken(token: TokenEntry, ctx: TokenContext): TokenVM {
  const data = token.data ?? {};
  const { bgCfg, perpStyle } = perpBg(data);
  let spriteHtml = renderSpriteHtml(bgCfg, 'consumed');
  spriteHtml += renderSpriteHtml(spriteOf(data.perp_sprite));
  if (token.database_amount && !token.locked) {
    spriteHtml += renderAmountHtml(token.database_amount, 'consumed');
  }
  return {
    gestalt: token.gestalt,
    locked: token.locked === true,
    perpStyle,
    spriteHtml,
    labelHtml: crlf2html(data.label),
    subpop: buildSubpop(token, ctx),
  };
}
