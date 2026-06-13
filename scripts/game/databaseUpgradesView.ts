// Database "buy supertokens" upgrades popup view-model — ports the
// generic `views/popup.html` as rendered by `Database.openUpgradesPopup`
// (issue #80 phase 2 tier 9).  Thin builder over the shared
// providedView, same shape as proxyView: `perp.html` tiles, the
// `mainsprites_class` header logo (DBUpgrade chip), MainButton always
// enabled, the database_buytokens copy.

import i18n from '../i18n.js';
import type { ProvidedPerpRow } from './GamePerp.js';
import { type ProvidedContext, type ProvidedPopupVM, buildProvided } from './providedView.js';

interface DatabaseUpgradesData {
  title?: string;
  subtitle?: string;
  description?: string;
  selectortitle?: string;
  providedPerps?: ProvidedPerpRow[];
  [k: string]: unknown;
}

export function buildDatabaseUpgradesPopupVM(
  data: DatabaseUpgradesData,
  ctx: ProvidedContext
): ProvidedPopupVM {
  const rows = data.providedPerps ?? [];
  const { tiles, subpops } = buildProvided(rows, 'perp', ctx);
  return {
    spriteHtml: '',
    mainspritesClass: 'DBUpgrade',
    title: data.title ?? i18n.gettext('database_buytokens title'),
    subtitle: data.subtitle ?? i18n.gettext('database_buytokens subtitle'),
    description: data.description ?? i18n.gettext('database_buytokens description'),
    selectorTitle: data.selectortitle ?? i18n.gettext('database_buytokens selector title'),
    tiles,
    subpops,
    // compileSuperTokens is synchronous (no server fetch), so the grid
    // is never in a loading state by the time the popup mounts.
    loading: false,
    noItemsText: i18n.gettext('Currently no items available'),
    loadingText: i18n.gettext('Loading items'),
    buttonText: i18n.gettext('Close'),
    buttonDisabled: false,
  };
}
