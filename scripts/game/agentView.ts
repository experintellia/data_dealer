// Agent buy popup view-model — ports `views/popup_agent.html` (issue
// #80 phase 2 tier 6).  Thin builder over the shared providedView,
// same shape as proxyView: `perp.html` tiles, generic `data.subtitle`,
// MainButton always enabled (popup_agent.html has no `!states.idle`
// gate), Agent-specific selector title + empty/loading copy.

import i18n from '../i18n.js';
import { type SpriteHelperConfig, renderSpriteHtml } from '../render/renderSpriteHelper.js';
import type { ProvidedPerpRow } from './GamePerp.js';
import { type ProvidedContext, type ProvidedPopupVM, buildProvided } from './providedView.js';

interface AgentData {
  popup_sprite?: SpriteHelperConfig;
  title?: string;
  subtitle?: string;
  description?: string;
  providedPerps?: ProvidedPerpRow[];
  buyablePerps?: unknown;
  [k: string]: unknown;
}

export function buildAgentPopupVM(
  data: AgentData,
  _states: { idle?: boolean } | undefined,
  ctx: ProvidedContext
): ProvidedPopupVM {
  const rows = data.providedPerps ?? [];
  const { tiles, subpops } = buildProvided(rows, 'perp', ctx);
  return {
    spriteHtml: renderSpriteHtml(data.popup_sprite),
    title: data.title ?? '',
    subtitle: data.subtitle ?? '',
    description: data.description ?? '',
    selectorTitle: i18n.gettext('agent_popup selector title'),
    tiles,
    subpops,
    // `compileProvided` clears providedPerps and only repopulates once
    // `buyablePerps` arrives from the server — so empty + undefined
    // buyable === the fetch is still in flight.
    loading: rows.length === 0 && data.buyablePerps === undefined,
    noItemsText: i18n.gettext('Sorry, currently I have<br />no new contacts for you.'),
    loadingText: i18n.gettext('agent_loading_contacts'),
    buttonText: i18n.gettext('Close'),
    // popup_agent.html MainButton has no `!states.idle` gate.
    buttonDisabled: false,
  };
}
