// CityPerp buy popup — Preact port of `views/popup_city.html`
// (computed in `game/cityView.ts`).  Issue #80 phase 2 tier 12.  A
// 4-tab `.PopupMenu` strip (mirrors ProjectPopup) over per-tab
// provided-perp grids reusing the shared perpShared tiles/subpops.
// No pagination (popup_city renders a single PerpPage per tab).

import { useCallback, useState } from 'preact/hooks';
import type { CityPopupVM } from '../../game/cityView.js';
import { PopupHeader } from './PopupHeader.js';
import { PopupMenu } from './PopupMenu.js';
import type { PreactDialogHandle } from './dialogManager.js';
import {
  NoItems,
  PerpProvidedSubpop,
  PerpProvidedSubpopDialog,
  PerpProvidedTile,
  fireAction,
  isMobileWidth,
  openSubpopDialog,
} from './perpShared.js';

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

  const handleOpenKey = useCallback(
    (key: number) => {
      if (isMobileWidth()) {
        const tab = vm.tabs.find((t) => t.pkey === activeTab);
        const subpop = tab?.subpops.find((s) => s.key === key);
        if (subpop) openSubpopDialog(PerpProvidedSubpopDialog, { subpop, parentPopup: popup });
      } else {
        setOpenKey(key);
      }
    },
    [vm.tabs, activeTab, popup]
  );

  const switchTab = (pkey: string): void => {
    if (pkey === activeTab) return;
    setOpenKey(null);
    setActiveTab(pkey);
  };

  return (
    <div class="PopupBody CityPerp">
      <PopupHeader
        onClose={onClose}
        spriteHtml={vm.spriteHtml}
        title={vm.title}
        subtitle={vm.subtitle}
        description={vm.description}
      >
        <PopupMenu
          tabs={vm.tabs.map((t) => ({ key: t.pkey, label: t.menuLabel }))}
          activeKey={activeTab}
          onSelect={switchTab}
        />
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
                  {t.tiles.length === 0 ? (
                    <NoItems
                      loading={t.loading}
                      textNoItems={t.noItemsText}
                      textLoading={t.loadingText}
                    />
                  ) : (
                    t.tiles.map((tile) => (
                      <PerpProvidedTile key={tile.key} tile={tile} onOpen={handleOpenKey} />
                    ))
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      {/* One button bar for the whole dialog (the action is identical on
          every city tab), rendered as a direct child of `.PopupBody`
          outside the scrolling, rounded `.PopupContent` so it straddles the
          dialog's bottom edge without WebKit clipping the overhang to
          `.PopupContent`'s border-radius. */}
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
}
