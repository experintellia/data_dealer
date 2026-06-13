// Proxy buy popup view-model — ports `views/popup_proxy.html` (issue
// #80 phase 2 tier 5c).  Thin builder over the shared providedView:
// `perp.html` tiles, a "Daughter companies: used/max" subtitle, the
// MainButton always enabled, custom empty-state copy.

import i18n from '../i18n.js';
import { type SpriteHelperConfig, renderSpriteHtml } from '../render/renderSpriteHelper.js';
import type { ProvidedPerpRow } from './GamePerp.js';
import { type ProvidedContext, type ProvidedPopupVM, buildProvided } from './providedView.js';

interface ProxyData {
  popup_sprite?: SpriteHelperConfig;
  title?: string;
  description?: string;
  used_slots?: number;
  max_slots?: number;
  providedPerps?: ProvidedPerpRow[];
  buyablePerps?: unknown;
  [k: string]: unknown;
}

export function buildProxyPopupVM(
  data: ProxyData,
  _states: { idle?: boolean } | undefined,
  ctx: ProvidedContext
): ProvidedPopupVM {
  const rows = data.providedPerps ?? [];
  const { tiles, subpops } = buildProvided(rows, 'perp', ctx);
  return {
    spriteHtml: renderSpriteHtml(data.popup_sprite),
    title: data.title ?? '',
    subtitle: `${i18n.gettext('Daughter companies:')} ${data.used_slots ?? 0}/${data.max_slots ?? 0}`,
    description: data.description ?? '',
    selectorTitle: i18n.gettext('proxy_popup selector title'),
    tiles,
    subpops,
    loading: rows.length === 0 && data.buyablePerps === undefined,
    noItemsText: i18n.gettext('Sorry, currently there are <br />no new business opportunities.'),
    loadingText: i18n.gettext('Looking for new ventures...'),
    buttonText: i18n.gettext('Close'),
    // popup_proxy.html MainButton has no `!states.idle` gate.
    buttonDisabled: false,
  };
}
