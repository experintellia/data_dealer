// Database profileset-import popup view-model — ports
// `views/popup_profileset.html` as rendered by
// `Database.openProfileSetPopup` (issue #80 phase 2 tier 10).
// Structurally a trimmed popup_contact: the same `token.html` /
// `subpop_token.html` grid (tokenView), a single Profiles summary
// (no Risk), and one "Import" MainButton (no Charge/Collect).

import { sprintf, toKSNum } from '../dd-helpers.js';
import i18n from '../i18n.js';
import { type SpriteHelperConfig, renderSpriteHtml } from '../render/renderSpriteHelper.js';
import { type TokenEntry, type TokenVM, buildToken } from './tokenView.js';

interface ProfileSetLike {
  profiles_value?: number;
  tokens_set?: TokenEntry[];
  origin?: { data?: Record<string, unknown> };
}

export interface ProfileSetPopupVM {
  spriteHtml: string;
  title: string;
  subtitle: string;
  description: string;
  tokens: TokenVM[];
  /** Tokens per page (legacy popup_profileset.html: 12). */
  pageSize: number;
  summaryProfiles: string;
  buttonText: string;
}

export function buildProfileSetPopupVM(ps: ProfileSetLike): ProfileSetPopupVM {
  const originData = ps.origin?.data ?? {};
  const profiles = ps.profiles_value ?? 0;
  // subpop_token.html here is called without `collect_amount`, so the
  // subpop subtitle falls back to each token's own `collect_amount`
  // (ProfileSet stamps that = profiles_value).
  const tokens = (ps.tokens_set ?? []).map((t) => buildToken(t, {}));
  return {
    spriteHtml: renderSpriteHtml(originData.popup_sprite as SpriteHelperConfig | undefined),
    title: sprintf(i18n.gettext('%s Profiles'), toKSNum(profiles)),
    subtitle: sprintf(i18n.gettext('Source: %s'), (originData.title as string) ?? ''),
    description: i18n.gettext(
      'All these new profiles need to be integrated into your main database. If you already have information on some of these people, your database will try to identify and update existing profiles using complicated mathematical methods.'
    ),
    tokens,
    pageSize: 12,
    summaryProfiles: toKSNum(profiles),
    buttonText: i18n.gettext('Import'),
  };
}
