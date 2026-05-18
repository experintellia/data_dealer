// CityPerp — the City perp.  Aggregates AgentPerp / PusherPerp /
// ProxyPerp / CityPerp tabs in its buy popup via `compileProvided`,
// flagging an `IPerps[gestalt]` bit at construction so other
// (UI-side) perps can check city ownership in O(1).
//
// Extracted from scripts/Game.js's IIFE in PR 12 of issue #147.

import { CityPopup } from '../components/popups/CityPopup.js';
import { type GameNodeConfig, getAllByGestalt, getByGestalt } from './GameNode.js';
import {
  GamePerp,
  type GameRootForPerp,
  type ProvidedPerpRow,
  type RenderPopupLike,
} from './GamePerp.js';
import { buildCityPopupVM } from './cityView.js';
import { type ProvidedContext, buildProvidedContext } from './providedView.js';

type TabKey = 'AgentPerp' | 'PusherPerp' | 'ProxyPerp' | 'CityPerp';

interface CityType {
  type_data?: ProvidedPerpRow['data'];
  gestalt?: string;
  [key: string]: unknown;
}

interface GameRootForCityPerp extends GameRootForPerp {
  getTypes(gameType: string): Record<string, CityType>;
}

export class CityPerp extends GamePerp {
  override renderType = 'Perp';
  override cableType = 'inout' as const;

  protected override get groot(): GameRootForCityPerp {
    return this.GameRoot as unknown as GameRootForCityPerp;
  }

  private providedCtx(): ProvidedContext {
    return buildProvidedContext(
      this.groot as unknown as Parameters<typeof buildProvidedContext>[0]
    );
  }

  override openPopup(): RenderPopupLike {
    const vm = buildCityPopupVM(
      (this.data ?? {}) as Parameters<typeof buildCityPopupVM>[0],
      this.providedCtx()
    );
    return this.openPreactPopup(CityPopup, { vm }) as RenderPopupLike;
  }

  // Live-loader Path-A re-mount (vclick empties providedTabs, then
  // fetchProvided → compileProvided → updatePopup) — see PusherPerp.
  override updatePopup(): RenderPopupLike {
    return this.openPopup();
  }

  constructor(config: GameNodeConfig) {
    super(config);
    if (this.gestalt !== undefined) {
      this.groot.IPerps[this.gestalt] = true;
    }
  }

  compileProvidedCities(): ProvidedPerpRow[] {
    const groot = this.groot;
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
    const groot = this.groot;
    const dataRec = this.data as {
      provided_perps?: string[];
      buyablePerps?: string[];
      providedPerps?: ProvidedPerpRow[];
      providedTabs?: Record<string, ProvidedPerpRow[]>;
    };

    const providedCache: Record<TabKey, string[]> = {
      AgentPerp: [],
      ProxyPerp: [],
      PusherPerp: [],
      CityPerp: this.compileProvidedCities().map((c) => c.gestalt),
    };
    (dataRec.provided_perps || []).forEach((v) => {
      if (v.startsWith('agent')) providedCache.AgentPerp.push(v);
      else if (v.startsWith('proxy')) providedCache.ProxyPerp.push(v);
      else if (v.startsWith('pusher')) providedCache.PusherPerp.push(v);
    });

    const tabs: Record<TabKey, ProvidedPerpRow[]> = {
      AgentPerp: [],
      PusherPerp: [],
      ProxyPerp: [],
      CityPerp: [],
    };
    dataRec.providedPerps = [];
    const buyable = new Set(dataRec.buyablePerps || []);

    // Pre-compute gestalt → instance count once instead of walking the
    // _ids registry per-row.  compileProvided is popup-open-time, not
    // a render hot path, but the pre-compute is cheap.
    const instanceCounts = new Map<string, number>();
    (Object.values(providedCache) as string[][]).forEach((list) => {
      list.forEach((g) => {
        if (!instanceCounts.has(g)) instanceCounts.set(g, getAllByGestalt(g).length);
      });
    });

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
        if (perp.data.max_instances && (instanceCounts.get(p) ?? 0) >= perp.data.max_instances) {
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
      CityPerp._stopProp(e);

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
