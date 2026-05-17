// Contact popup view-model — ports `views/popup_contact.html` +
// `profileset.html` + `token.html` + `subpop_token.html` (issue #80
// phase 2 tier 5a).  The legacy partials stay on disk (shared with
// popup_project / popup_client etc.); this duplicates their logic in
// TS during the transition, same pattern as `missionView.ts`.  The
// Preact `ContactPopup` just renders the result.

import { crlf2html, sprintf, toKSNum, toTime } from '../dd-helpers.js';
import i18n from '../i18n.js';
import { renderAmountHtml } from '../render/RenderTopLevelUI.js';
import { type SpriteHelperConfig, renderSpriteHtml } from '../render/renderSpriteHelper.js';

interface TokenEntry {
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

interface ContactData {
  popup_sprite?: SpriteHelperConfig;
  title?: string;
  description?: string;
  button_text?: string;
  charge_cost?: number;
  charge_time?: number;
  collect_amount?: number;
  collect_risk?: number;
  ProfileSet?: { tokens_set?: TokenEntry[] };
  [k: string]: unknown;
}

/** One token tile (`token.html`) + its detail subpop
 *  (`subpop_token.html`). */
export interface TokenVM {
  gestalt: string;
  locked: boolean;
  /** Absolute-positioned `.PopupTokenPerp` inline style. */
  perpStyle: string;
  /** Stacked sprite HTML, in `token.html` order: optional "New!"
   *  ribbon, background (+ supertoken variant), perp sprite,
   *  RenderAmount.  The ribbon is baked in (not a Preact child) so the
   *  stack is the direct innerHTML of `.PopupTokenPerp`, matching the
   *  still-live shared `token.html` under shared CSS. */
  spriteHtml: string;
  labelHtml: string;
  /** Detail subpop fields. */
  subpop: {
    logoHtml: string;
    title: string;
    subTitleHtml: string;
    description: string;
  };
}

export interface ContactPopupVM {
  spriteHtml: string;
  title: string;
  description: string;
  /** `true` → render the Collect button block; `false` → Charge. */
  collectMode: boolean;
  /** Charge button disabled (legacy `!states.idle`). */
  chargeDisabled: boolean;
  buttonText: string;
  chargeCostText: string;
  chargeTimeText: string;
  tokens: TokenVM[];
  /** Tokens per page (legacy profileset.html: 12). */
  pageSize: number;
  summaryProfiles: string;
  summaryRisk: string;
  summaryRiskUp: boolean;
}

const SPRITE_BOX = 38;

function spriteOf(v: unknown): SpriteHelperConfig | undefined {
  return v as SpriteHelperConfig | undefined;
}

function buildToken(token: TokenEntry, contactCollectAmount: number | undefined): TokenVM {
  const data = token.data ?? {};
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

  // token.html order: "New!" ribbon first, then sprite stack.
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

  // subpop_token.html: `collect_amount = D.collect_amount ||
  // token.collect_amount` where D.collect_amount is the contact-level
  // value threaded by profileset.html.  Gate is `if (collect_amount)`
  // then `else if (database_amount)` — not gated on the text.
  const collectAmount = contactCollectAmount || token.collect_amount;
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
    gestalt: token.gestalt,
    locked: token.locked === true,
    perpStyle: `position:absolute; top:${offsetY}px; left:${offsetX}px; width:${width}px; height:${height}px;`,
    spriteHtml,
    labelHtml: crlf2html(data.label),
    subpop: {
      logoHtml: renderSpriteHtml(spriteOf(data.popup_sprite)),
      title: (data.title as string | undefined) ?? '',
      subTitleHtml,
      description: (data.description as string | undefined) ?? '',
    },
  };
}

export function buildContactPopupVM(
  data: ContactData,
  states: { idle?: boolean; chargeRunning?: boolean } | undefined
): ContactPopupVM {
  const tokens = (data.ProfileSet?.tokens_set ?? []).map((t) => buildToken(t, data.collect_amount));
  const collectMode = !states?.idle && !states?.chargeRunning;
  const collectRisk = data.collect_risk ?? 0;
  return {
    spriteHtml: renderSpriteHtml(data.popup_sprite),
    title: data.title ?? '',
    description: data.description ?? '',
    collectMode,
    chargeDisabled: !states?.idle,
    buttonText: data.button_text ?? '',
    chargeCostText: toKSNum(data.charge_cost ?? 0),
    chargeTimeText: toTime(data.charge_time ?? 0),
    tokens,
    pageSize: 12,
    summaryProfiles: toKSNum(data.collect_amount ?? 0),
    summaryRisk: toKSNum(Math.abs(collectRisk)),
    summaryRiskUp: collectRisk < 1,
  };
}
