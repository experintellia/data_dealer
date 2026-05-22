// Pusher / Proxy buy popup — Preact port of `views/popup_pusher.html`
// + `views/popup_proxy.html` (+ the shared client/perp/subpop_perp_
// provided/values/noitems partials, computed in providedView.ts).
// Issue #80 phase 2 tier 5c.  Both popups share this shell; the
// per-perp views resolve the subtitle / selector title / tile kind /
// button-disabled / empty-state copy into one `ProvidedPopupVM`.

import { useState } from 'preact/hooks';
import type { ProvidedPopupVM } from '../../game/providedView.js';
import { PopupHeader } from './PopupHeader.js';
import type { PreactDialogHandle } from './dialogManager.js';
import { NoItems, PerpProvidedSubpop, PerpProvidedTile, fireAction } from './perpShared.js';

export interface ProvidedPerpPopupProps {
  vm: ProvidedPopupVM;
  /** Framework-injected by the dialog manager. */
  onClose: () => void;
  /** Framework-injected — the live perp popup handle. */
  popup: PreactDialogHandle;
}

export function ProvidedPerpPopup({ vm, onClose, popup }: ProvidedPerpPopupProps) {
  const [openKey, setOpenKey] = useState<number | null>(null);
  // Open/close is just the `.open` toggle: the CSS opacity+scale fade
  // dissolves the whole card cleanly on close (no transparent-bg hack).
  const openSubpop = (key: number): void => setOpenKey(key);
  const closeSubpop = (): void => setOpenKey(null);

  return (
    <div class="PopupBody ProvidedPerp">
      <PopupHeader
        onClose={onClose}
        mainspritesClass={vm.mainspritesClass}
        spriteHtml={vm.spriteHtml}
        title={vm.title}
        subtitle={vm.subtitle}
        description={vm.description}
      />
      <div class="PopupContent">
        <div class="PopupTab">
          {/* All subpops stay mounted; only `.open` toggles (matches
              the legacy SubpopContainer reveal — no grid re-render). */}
          <div class={openKey !== null ? 'SubpopContainer open' : 'SubpopContainer'}>
            {vm.subpops.map((s) => (
              <PerpProvidedSubpop
                key={s.key}
                subpop={s}
                isOpen={openKey === s.key}
                onClose={closeSubpop}
                popup={popup}
              />
            ))}
          </div>
          {/* Legacy `.Selector.hasPopup { display:none }` — hide the
              whole selector (grid + standalone arrows + header) while
              a token subpop overlays it, so the arrows don't poke out
              from behind the overlay. */}
          <div class={`Pagination Selector standalone${openKey !== null ? ' hasPopup' : ''}`}>
            {vm.selectorTitle || vm.karmaChip ? (
              <div class="SubpopHeader">
                {vm.karmaChip ? (
                  <div class={`PopupSummaryItem Risk ${vm.karmaChip.up ? 'Up' : 'Down'}`}>
                    <div class="RenderSprite Tobi" />
                    {vm.karmaChip.text}
                  </div>
                ) : null}
                <div class="SubpopHeaderTitle">{vm.selectorTitle}</div>
              </div>
            ) : null}
            <div class="PopupSelector">
              <div class="PopupPageWrap">
                {vm.tiles.length === 0 ? (
                  <NoItems
                    loading={vm.loading}
                    textNoItems={vm.noItemsText}
                    textLoading={vm.loadingText}
                  />
                ) : (
                  <div class="PopupPage PerpPage">
                    {vm.tiles.map((t) => (
                      <PerpProvidedTile key={t.key} tile={t} onOpen={openSubpop} />
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
          <div class="PopupButtons">
            {/* biome-ignore lint/a11y/useKeyWithClickEvents: legacy DOM structure, keyboard support is a separate a11y pass */}
            <div
              class={vm.buttonDisabled ? 'Button disabled' : 'Button'}
              data-button-id="MainButton"
              onClick={(e) => fireAction(popup, e, 'MainButton')}
            >
              {vm.buttonText}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
