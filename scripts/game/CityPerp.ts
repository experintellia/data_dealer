// CityPerp — the City perp.  Aggregates AgentPerp / PusherPerp /
// ProxyPerp / CityPerp tabs in its buy popup via `compileProvided`,
// flagging an `IPerps[gestalt]` bit at construction so other
// (UI-side) perps can check city ownership in O(1).
//
// Extracted from scripts/Game.js's IIFE in PR 12 of issue #147.

import { type GameNodeConfig, getAllByGestalt, getByGestalt } from './GameNode.js';
import { GamePerp } from './GamePerp.js';

interface ProvidedPerpRow {
  gestalt: string;
  data: Record<string, unknown> & {
    required_level?: number;
    required_providers?: string[];
    requiredProviders?: string[];
    max_instances?: number;
    title?: string;
    is_city?: boolean;
    [key: string]: unknown;
  };
  locked?: boolean;
  bought?: boolean;
}

type TabKey = 'AgentPerp' | 'PusherPerp' | 'ProxyPerp' | 'CityPerp';

interface CityType {
  type_data?: ProvidedPerpRow['data'];
  gestalt?: string;
  [key: string]: unknown;
}

interface GameRootForCityPerp {
  IPerps: Record<string, true>;
  xp_level: { number: number; [key: string]: unknown };
  getTypes(gameType: string): Record<string, CityType>;
  getTypeData(gestalt?: string): ProvidedPerpRow['data'] | undefined;
}

export class CityPerp extends GamePerp {
  override renderType = 'Perp';
  override cableType = 'inout' as const;
  override popupTemplate = 'popup_city.html';

  constructor(config: GameNodeConfig) {
    super(config);
    if (this.gestalt !== undefined) {
      (this.GameRoot as unknown as GameRootForCityPerp).IPerps[this.gestalt] = true;
    }
  }

  compileProvidedCities(): ProvidedPerpRow[] {
    const groot = this.GameRoot as unknown as GameRootForCityPerp;
    const dataRec = this.data as {
      providedCities?: ProvidedPerpRow[];
      buyablePerps?: string[];
    };
    dataRec.providedCities = [];
    const types = groot.getTypes('CityPerp');
    Object.values(types).forEach((p) => {
      const gestalt = p.gestalt;
      if (!gestalt) return;
      const data = (p.type_data || {}) as ProvidedPerpRow['data'];
      // FIXME: no game_type in template
      data.is_city = true;
      const city: ProvidedPerpRow = { gestalt, data };
      if (!getByGestalt(gestalt)) {
        dataRec.providedCities?.push(city);
        if (
          typeof data.required_level === 'number' &&
          data.required_level <= groot.xp_level.number
        ) {
          dataRec.buyablePerps?.push(gestalt);
        }
      }
    });
    return dataRec.providedCities;
  }

  override compileProvided(): void {
    const groot = this.GameRoot as unknown as GameRootForCityPerp;
    const dataRec = this.data as {
      provided_perps?: string[];
      buyablePerps?: string[];
      providedPerps?: ProvidedPerpRow[];
      providedTabs?: Record<string, ProvidedPerpRow[]>;
    };

    const provided = dataRec.provided_perps || [];
    const providedCache: Record<TabKey, string[]> = {
      AgentPerp: provided.filter((v) => v.substring(0, 5) === 'agent'),
      ProxyPerp: provided.filter((v) => v.substring(0, 5) === 'proxy'),
      PusherPerp: provided.filter((v) => v.substring(0, 6) === 'pusher'),
      CityPerp: this.compileProvidedCities().map((c) => c.gestalt),
    };

    const tabs: Record<TabKey, ProvidedPerpRow[]> = {
      AgentPerp: [],
      PusherPerp: [],
      ProxyPerp: [],
      CityPerp: [],
    };
    dataRec.providedTabs = tabs;
    dataRec.providedPerps = dataRec.providedPerps || [];
    const buyable = new Set(dataRec.buyablePerps || []);

    (Object.keys(tabs) as TabKey[]).forEach((k) => {
      const tab = tabs[k];
      providedCache[k].forEach((p) => {
        const type_data = (groot.getTypeData(p) || {}) as ProvidedPerpRow['data'];
        const perp: ProvidedPerpRow = {
          gestalt: p,
          data: type_data,
          locked: !buyable.has(p),
        };
        // FIXME: this property should come from the backend and doesn't
        // need to be set here.
        if (!perp.data.max_instances) {
          perp.data.max_instances = 1;
        }
        if (perp.data.max_instances && getAllByGestalt(p).length >= perp.data.max_instances) {
          perp.locked = true;
          perp.bought = true;
        }
        if (perp.locked && Object.prototype.hasOwnProperty.call(groot.IPerps, p)) {
          perp.bought = true;
          return;
        }
        if (perp.locked && perp.data.required_providers && perp.data.required_providers.length) {
          perp.data.requiredProviders = [];
          perp.data.required_providers.forEach((v) => {
            const tdata = groot.getTypeData(v);
            if (tdata && typeof tdata.title === 'string') {
              perp.data.requiredProviders?.push(tdata.title);
            }
          });
        }
        dataRec.providedPerps?.push(perp);
        tab.push(perp);
      });
      tabs[k] = tab.slice().sort((a, b) => {
        const ra = a.data.required_level ?? 0;
        const rb = b.data.required_level ?? 0;
        return ra - rb;
      });
    });
    dataRec.providedTabs = tabs;
  }

  override extendEventHandlers(): void {
    const gnode = this;
    this.on('vclick', function (e: unknown) {
      const stop = (e as { stopPropagation?: () => void } | null | undefined)?.stopPropagation;
      if (typeof stop === 'function') stop.call(e);

      // Empty the Tabs (later used for loader in popup).
      const dataRec = gnode.data as {
        providedTabs?: Record<string, ProvidedPerpRow[]>;
      };
      dataRec.providedTabs = { agents: [], pusher: [], proxies: [] };

      gnode.fetchProvided?.(function () {
        gnode.compileProvided();
        if (gnode.renderPopup) {
          gnode.updatePopup();
        }
      });
      gnode.openPopup();
    });
  }
}
