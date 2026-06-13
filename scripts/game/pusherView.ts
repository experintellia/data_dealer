// Pusher buy popup view-model — ports `views/popup_pusher.html`
// (issue #80 phase 2 tier 5c).  Thin builder over the shared
// providedView: `client.html` tiles, generic `data.subtitle`,
// MainButton disabled on `!states.idle`.

import i18n from '../i18n.js';
import { type SpriteHelperConfig, renderSpriteHtml } from '../render/renderSpriteHelper.js';
import type { ProvidedPerpRow } from './GamePerp.js';
import { type ProvidedContext, type ProvidedPopupVM, buildProvided } from './providedView.js';

interface PusherData {
  popup_sprite?: SpriteHelperConfig;
  title?: string;
  subtitle?: string;
  description?: string;
  providedPerps?: ProvidedPerpRow[];
  buyablePerps?: unknown;
  [k: string]: unknown;
}

export function buildPusherPopupVM(
  data: PusherData,
  states: { idle?: boolean } | undefined,
  ctx: ProvidedContext
): ProvidedPopupVM {
  const rows = data.providedPerps ?? [];
  const { tiles, subpops } = buildProvided(rows, 'client', ctx);
  return {
    spriteHtml: renderSpriteHtml(data.popup_sprite),
    title: data.title ?? '',
    subtitle: data.subtitle ?? '',
    description: data.description ?? '',
    selectorTitle: i18n.gettext('pusher_popup selector title'),
    tiles,
    subpops,
    // `compileProvided` clears providedPerps and only repopulates once
    // `buyablePerps` arrives from the server — so empty + undefined
    // buyable === the fetch is still in flight.
    loading: rows.length === 0 && data.buyablePerps === undefined,
    noItemsText: i18n.gettext('Currently no items available'),
    loadingText: i18n.gettext('Loading items'),
    buttonText: i18n.gettext('Close'),
    buttonDisabled: !states?.idle,
  };
}
