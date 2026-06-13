// Karma popup view-model — ports `views/popup_karma.html` (issue #80
// phase 2 tier 13).  Shared by both entry paths: the karma-status
// click (mainsprites 'karma' logo) and the Karmalizer-incident
// notification (sprite logo + "karma Problem!" title/subtitle swap).
// Reuses the shared ProvidedPerpPopup via the `karmaChip`
// SubpopHeader extension — no dedicated component.

import { toKSNum } from '../dd-helpers.js';
import i18n from '../i18n.js';
import { type SpriteHelperConfig, renderSpriteHtml } from '../render/renderSpriteHelper.js';
import type { ProvidedPerpRow } from './GamePerp.js';
import { type ProvidedContext, type ProvidedPopupVM, buildProvided } from './providedView.js';

interface KarmaData {
  popup_sprite?: SpriteHelperConfig;
  mainsprites_class?: string;
  title?: string;
  description?: string;
  selectortitle?: string;
  button?: string;
  game_type?: string;
  providedKarma?: ProvidedPerpRow[];
  [k: string]: unknown;
}

export function buildKarmaPopupVM(
  data: KarmaData,
  karmaValue: number,
  ctx: ProvidedContext
): ProvidedPopupVM {
  const rows = data.providedKarma ?? [];
  const { tiles, subpops } = buildProvided(rows, 'perp', ctx);
  const isKarmalizer = data.game_type === 'Karmalizer';
  return {
    spriteHtml: renderSpriteHtml(data.popup_sprite),
    ...(data.mainsprites_class !== undefined && { mainspritesClass: data.mainsprites_class }),
    title: isKarmalizer ? i18n.gettext('karma Problem!') : (data.title ?? ''),
    subtitle: isKarmalizer ? (data.title ?? '') : '',
    description: data.description ?? '',
    selectorTitle: data.selectortitle ?? '',
    karmaChip: { up: karmaValue >= 0, text: toKSNum(Math.abs(karmaValue)) },
    tiles,
    subpops,
    // compileProvidedKarma is synchronous (no server fetch).
    loading: false,
    noItemsText: i18n.gettext('Currently no items available'),
    loadingText: i18n.gettext('Loading items'),
    buttonText: data.button ?? i18n.gettext('Close'),
    buttonDisabled: false,
  };
}
