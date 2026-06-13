// Contact popup view-model — ports `views/popup_contact.html` +
// `profileset.html` (issue #80 phase 2 tier 5a).  The token / subpop
// partials are the shared `tokenView.ts` (also used by Client tier
// 5b).  The Preact `ContactPopup` just renders the result.

import { toKSNum, toTime } from '../dd-helpers.js';
import { type SpriteHelperConfig, renderSpriteHtml } from '../render/renderSpriteHelper.js';
import { type TokenEntry, type TokenVM, buildToken } from './tokenView.js';

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
  summaryProfiles: string;
  summaryRisk: string;
  summaryRiskUp: boolean;
}

export function buildContactPopupVM(
  data: ContactData,
  states: { idle?: boolean; chargeRunning?: boolean } | undefined
): ContactPopupVM {
  const tokens = (data.ProfileSet?.tokens_set ?? []).map((t) => buildToken(t, data));
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
    summaryProfiles: toKSNum(data.collect_amount ?? 0),
    summaryRisk: toKSNum(Math.abs(collectRisk)),
    summaryRiskUp: collectRisk < 1,
  };
}
