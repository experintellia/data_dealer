// CityPerp buy popup — Preact port of `views/popup_city.html`
// (computed in `game/cityView.ts`).  Issue #80 phase 2 tier 12.  A
// 4-tab `.PopupMenu` strip (mirrors ProjectPopup) over per-tab
// provided-perp grids reusing the shared perpShared tiles/subpops.
// No pagination (popup_city renders a single PerpPage per tab).

import { useState } from 'preact/hooks';
import type { CityPopupVM } from '../../game/cityView.js';
import { PopupHeader } from './PopupHeader.js';
import type { PreactDialogHandle } from './dialogManager.js';
import { NoItems, PerpProvidedSubpop, PerpProvidedTile, fireAction } from './perpShared.js';

export interface CityPopupProps {
  vm: CityPopupVM;
  /** Framework-injected by the dialog manager. */
  onClose: () => void;
  /** Framework-injected — the live perp popup handle. */
  popup: PreactDialogHandle;
}

export function CityPopup({ vm, onClose, popup }: CityPopupProps) {
  const [activeTab, setActiveTab] = useState<string>(vm.tabs[0]?.pkey ?? 'AgentPerp');
  // Subpop open state — a tile in a hidden tab can't be clicked and
  // tab-switch closes any open subpop, so a single key scoped to the
  // active tab is enough.
  const [openKey, setOpenKey] = useState<number | null>(null);

  const switchTab = (pkey: string): void => {
    if (pkey === activeTab) return;
    setOpenKey(null);
    setActiveTab(pkey);
  };

  return (
    <div class="PopupBody">
      <PopupHeader
        onClose={onClose}
        spriteHtml={vm.spriteHtml}
        title={vm.title}
        subtitle={vm.subtitle}
        description={vm.description}
      >
        <div class="PopupMenu">
          {vm.tabs.map((t) => (
            // biome-ignore lint/a11y/useKeyWithClickEvents: legacy DOM structure, keyboard support is a separate a11y pass
            <div
              key={t.pkey}
              class={activeTab === t.pkey ? 'PopupMenuButton active' : 'PopupMenuButton'}
              data-tab={t.pkey}
              onClick={() => switchTab(t.pkey)}
            >
              {t.menuLabel}
            </div>
          ))}
        </div>
      </PopupHeader>
      <div class="PopupContent">
        {vm.tabs.map((t) => {
          const tabActive = activeTab === t.pkey;
          const containerOpen = tabActive && openKey !== null;
          return (
            <div key={t.pkey} class={tabActive ? 'PopupTab' : 'PopupTab hidden'} data-tab={t.pkey}>
              <div class={containerOpen ? 'SubpopContainer open' : 'SubpopContainer'}>
                {t.subpops.map((s) => (
                  <PerpProvidedSubpop
                    key={s.key}
                    subpop={s}
                    isOpen={tabActive && openKey === s.key}
                    onClose={() => setOpenKey(null)}
                    popup={popup}
                  />
                ))}
              </div>
              {/* Legacy `.Selector.hasPopup { display:none }` — hide
                  the selector (incl. standalone arrows) under an open
                  token subpop overlay. */}
              <div class={`Pagination Selector standalone${containerOpen ? ' hasPopup' : ''}`}>
                <div class="SubpopHeader">
                  <div class="SubpopHeaderTitle">{t.selectorTitle}</div>
                </div>
                <div class="PopupSelector">
                  <div class="PopupPageWrap">
                    {t.tiles.length === 0 ? (
                      <NoItems
                        loading={t.loading}
                        textNoItems={t.noItemsText}
                        textLoading={t.loadingText}
                      />
                    ) : (
                      <div class="PopupPage PerpPage">
                        {t.tiles.map((tile) => (
                          <PerpProvidedTile key={tile.key} tile={tile} onOpen={setOpenKey} />
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
              <div class="PopupButtons">
                {/* biome-ignore lint/a11y/useKeyWithClickEvents: legacy DOM structure, keyboard support is a separate a11y pass */}
                <div
                  class="Button"
                  data-button-id="MainButton"
                  onClick={(e) => fireAction(popup, e, 'MainButton')}
                >
                  {vm.buttonText}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
