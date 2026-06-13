// Client popup view-model — ports `views/popup_client.html` +
// `profileset_client.html` (issue #80 phase 2 tier 5b).  Unlike
// Contact, the client popup renders TWO token sets — `ProfileSet`
// (blue / "provided", 7/page) and `ConsumedProfileSet` (orange /
// "consumed", 6/page, the `token_consumed.html` variant) — split by a
// ClientDivider, and a single Cash/Penalty income summary (no Risk).
// Token / subpop partials are the shared `tokenView.ts`.

import { span, toKSNum, toTime } from '../dd-helpers.js';
import { type SpriteHelperConfig, renderSpriteHtml } from '../render/renderSpriteHelper.js';
import { type TokenEntry, type TokenVM, buildConsumedToken, buildToken } from './tokenView.js';

interface ClientData {
  popup_sprite?: SpriteHelperConfig;
  title?: string;
  description?: string;
  button_text?: string;
  charge_time?: number;
  collect_amount?: number;
  income?: number;
  income_nopenalty?: number;
  karma_penalty?: boolean;
  ProfileSet?: { tokens_set?: TokenEntry[] };
  ConsumedProfileSet?: { tokens_set?: TokenEntry[] };
  [k: string]: unknown;
}

export interface ClientPopupVM {
  spriteHtml: string;
  title: string;
  description: string;
  /** `true` → render the Collect button block; `false` → Charge. */
  collectMode: boolean;
  /** Charge button disabled (legacy `!states.idle`). */
  chargeDisabled: boolean;
  buttonText: string;
  chargeTimeText: string;
  /** Blue "provided" tokens (`token.html`). */
  providedTokens: TokenVM[];
  /** Orange "consumed" tokens (`token_consumed.html`). */
  consumedTokens: TokenVM[];
  /** `.ClientDividerItem` count: `min(provided.length, 7)`. */
  dividerCount: number;
  /** Summary item modifier — `Penalty` when karma scales the income. */
  summaryClass: 'Cash' | 'Penalty';
  /** Income text; on penalty: `<span class=penalty>income</span> /
   *  income_nopenalty` (HTML, hence not a plain string render). */
  summaryHtml: string;
}

export function buildClientPopupVM(
  data: ClientData,
  states: { idle?: boolean; chargeRunning?: boolean } | undefined
): ClientPopupVM {
  const providedTokens = (data.ProfileSet?.tokens_set ?? []).map((t) => buildToken(t, data));
  const consumedTokens = (data.ConsumedProfileSet?.tokens_set ?? []).map((t) =>
    buildConsumedToken(t, data)
  );
  const penalty = data.karma_penalty === true;
  const income = data.income ?? 0;
  return {
    spriteHtml: renderSpriteHtml(data.popup_sprite),
    title: data.title ?? '',
    description: data.description ?? '',
    collectMode: !states?.idle && !states?.chargeRunning,
    chargeDisabled: !states?.idle,
    buttonText: data.button_text ?? '',
    // Legacy default: `_.toTime(data.charge_time||6666)`.
    chargeTimeText: toTime(data.charge_time || 6666),
    providedTokens,
    consumedTokens,
    dividerCount: Math.min(providedTokens.length, 7),
    summaryClass: penalty ? 'Penalty' : 'Cash',
    summaryHtml: penalty
      ? `${span(toKSNum(income), 'penalty')} / ${toKSNum(data.income_nopenalty ?? 0)}`
      : toKSNum(income),
  };
}
