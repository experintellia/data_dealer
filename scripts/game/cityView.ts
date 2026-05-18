// CityPerp buy popup view-model — ports `views/popup_city.html`
// (issue #80 phase 2 tier 12).  A 4-tab `.PopupMenu` (Agents /
// Pushers / Bogus / City) over per-tab provided-perp grids; each tab
// reuses the shared providedView (`agent` / `pusher` / `perp` tile
// kinds) + perpShared tiles/subpops, the tab strip mirrors
// ProjectPopup.  No pagination (popup_city renders one PerpPage).

import i18n from '../i18n.js';
import { type SpriteHelperConfig, renderSpriteHtml } from '../render/renderSpriteHelper.js';
import type { ProvidedPerpRow } from './GamePerp.js';
import {
  type ProvidedContext,
  type ProvidedSubpopVM,
  type ProvidedTileVM,
  buildProvided,
} from './providedView.js';

export type CityTabKey = 'AgentPerp' | 'PusherPerp' | 'ProxyPerp' | 'CityPerp';

interface CityData {
  popup_sprite?: SpriteHelperConfig;
  title?: string;
  subtitle?: string;
  description?: string;
  button?: string;
  providedTabs?: Record<string, ProvidedPerpRow[]>;
  [k: string]: unknown;
}

export interface CityTabVM {
  pkey: CityTabKey;
  menuLabel: string;
  selectorTitle: string;
  tiles: ProvidedTileVM[];
  subpops: ProvidedSubpopVM[];
  loading: boolean;
  noItemsText: string;
  loadingText: string;
}

export interface CityPopupVM {
  spriteHtml: string;
  title: string;
  subtitle: string;
  description: string;
  buttonText: string;
  tabs: CityTabVM[];
}

const TAB_SPEC: {
  pkey: CityTabKey;
  menuKey: string;
  selectorKey: string;
  kind: 'agent' | 'pusher' | 'perp';
}[] = [
  { pkey: 'AgentPerp', menuKey: 'Agents', selectorKey: 'Buy an Agent', kind: 'agent' },
  { pkey: 'PusherPerp', menuKey: 'Pushers', selectorKey: 'Buy a Pusher', kind: 'pusher' },
  { pkey: 'ProxyPerp', menuKey: 'Bogus Companies', selectorKey: 'Buy a Proxy', kind: 'perp' },
  { pkey: 'CityPerp', menuKey: 'city_buy tab', selectorKey: 'city_buy selector', kind: 'perp' },
];

export function buildCityPopupVM(data: CityData, ctx: ProvidedContext): CityPopupVM {
  const provided = data.providedTabs;
  // extendEventHandlers seeds `providedTabs` with loader keys
  // (agents/pusher/proxies) before fetchProvided; the real per-type
  // keys only appear after compileProvided — use that as the
  // loaded/loading discriminant.
  const compiled = !!provided && 'AgentPerp' in provided;
  const tabs: CityTabVM[] = TAB_SPEC.map((spec) => {
    const rows = provided?.[spec.pkey] ?? [];
    const { tiles, subpops } = buildProvided(rows, spec.kind, ctx);
    return {
      pkey: spec.pkey,
      menuLabel: i18n.gettext(spec.menuKey),
      selectorTitle: i18n.gettext(spec.selectorKey),
      tiles,
      subpops,
      loading: !compiled,
      noItemsText: i18n.gettext('Currently no items available'),
      loadingText: i18n.gettext('Loading items'),
    };
  });
  return {
    spriteHtml: renderSpriteHtml(data.popup_sprite),
    title: data.title ?? '',
    subtitle: data.subtitle ?? '',
    description: data.description ?? '',
    buttonText: data.button ?? i18n.gettext('Close'),
    tabs,
  };
}
