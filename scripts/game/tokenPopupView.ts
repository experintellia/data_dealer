// TokenPerp popup view-model — ports `views/popup_token.html` +
// `profileset_token.html` + `subpop_token_upgrade.html` (issue #80
// phase 2 tier 11).  Two layouts keyed by `isSuper`
// (`data.contained_tokens.length`):
//   - normal token: header + a single Close MainButton, no content;
//   - SuperToken: header + the profileset_token grid (token.html tiles
//     reusing tokenView.buildToken, the new TokenUpgrade subpop) +
//     a Compute/Update Charge-Collect footer.

import { sprintf, toKSNum, toTime } from '../dd-helpers.js';
import i18n from '../i18n.js';
import { type SpriteHelperConfig, renderSpriteHtml } from '../render/renderSpriteHelper.js';
import { type TokenEntry, type TokenVM, buildToken } from './tokenView.js';

interface TokenPopupData {
  popup_sprite?: SpriteHelperConfig;
  title?: string;
  description?: string;
  knowledge_text?: string;
  origin_stats_text?: string;
  absoluteAmount?: number;
  charge_time?: number;
  collect_amount?: number;
  contained_tokens?: unknown[];
  ProfileSet?: { tokens_set?: TokenEntry[] };
  [k: string]: unknown;
}

/** `subpop_token_upgrade.html` — the per-token "analyzed / not yet
 *  analyzed" detail card (distinct from the findings `subpop_token`). */
export interface TokenUpgradeSubpopVM {
  subpopId: string;
  logoHtml: string;
  title: string;
  todoLabel: string;
  todoText: string;
  doneLabel: string;
  doneText: string;
  description: string;
}

export interface TokenPopupVM {
  isSuper: boolean;
  spriteHtml: string;
  title: string;
  /** `sprintf(knowledge_text||origin_stats_text, amount)` — legacy
   *  `<% print(...) %>` (raw), rendered as innerHTML. */
  subtitleHtml: string;
  description: string;
  /** Non-super: the single Close MainButton label. */
  closeButtonText: string;
  // ---- SuperToken-only ----
  tokens: TokenVM[];
  upgradeSubpops: TokenUpgradeSubpopVM[];
  summaryLabel: string;
  collectMode: boolean;
  chargeDisabled: boolean;
  chargeButtonText: string;
  collectButtonText: string;
  chargeTimeText: string;
}

function spriteOf(v: unknown): SpriteHelperConfig | undefined {
  return v as SpriteHelperConfig | undefined;
}

function buildTokenUpgradeSubpop(token: TokenEntry): TokenUpgradeSubpopVM {
  const data = (token.data ?? {}) as Record<string, unknown>;
  const t = token as TokenEntry & { doneAbsoluteAmount?: number };
  return {
    subpopId: `token${token.gestalt}`,
    logoHtml: renderSpriteHtml(spriteOf(data.popup_sprite)),
    title: (data.title as string | undefined) ?? '',
    todoLabel: i18n.gettext('subpopup_token Data not yet analyzed:'),
    todoText: toKSNum(t.diffAbsoluteAmount ?? 0),
    doneLabel: i18n.gettext('subpopup_token Data already analyzed:'),
    doneText: toKSNum(t.doneAbsoluteAmount ?? 0),
    description: i18n.gettext('subpopup_token description'),
  };
}

export function buildTokenPopupVM(
  data: TokenPopupData,
  states: { idle?: boolean; chargeRunning?: boolean; zeroresult?: boolean } | undefined
): TokenPopupVM {
  const isSuper = (data.contained_tokens?.length ?? 0) > 0;
  const knowledge = data.knowledge_text || data.origin_stats_text || '';
  const tokensSet = data.ProfileSet?.tokens_set ?? [];
  const tokens = tokensSet.map((t) => buildToken(t, {}));
  const upgradeSubpops = tokensSet
    .filter((t) => t.locked !== true)
    .map((t) => buildTokenUpgradeSubpop(t));
  return {
    isSuper,
    spriteHtml: renderSpriteHtml(data.popup_sprite),
    title: data.title ?? '',
    subtitleHtml: sprintf(knowledge, toKSNum(data.absoluteAmount ?? 0)),
    description: data.description ?? '',
    closeButtonText: i18n.gettext('Close'),
    tokens,
    upgradeSubpops,
    summaryLabel: i18n.gettext('Data that can be analyzed'),
    collectMode: !states?.idle && !states?.chargeRunning,
    chargeDisabled: !states?.idle || states?.zeroresult === true,
    chargeButtonText: i18n.gettext('Compute'),
    collectButtonText: i18n.gettext('Update'),
    chargeTimeText: toTime(data.charge_time ?? 0),
  };
}
