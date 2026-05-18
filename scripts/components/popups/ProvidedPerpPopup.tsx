// Pusher / Proxy buy popup — Preact port of `views/popup_pusher.html`
// + `views/popup_proxy.html` (+ the shared client/perp/subpop_perp_
// provided/values/noitems partials, computed in providedView.ts).
// Issue #80 phase 2 tier 5c.  Both popups share this shell; the
// per-perp views resolve the subtitle / selector title / tile kind /
// button-disabled / empty-state copy into one `ProvidedPopupVM`.

import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { ProvidedPopupVM } from '../../game/providedView.js';
import type { PreactDialogHandle } from './dialogManager.js';
import {
  NoItems,
  PageArrows,
  PerpProvidedSubpop,
  PerpProvidedTile,
  fireAction,
} from './perpShared.js';

export interface ProvidedPerpPopupProps {
  vm: ProvidedPopupVM;
  /** Framework-injected by the dialog manager. */
  onClose: () => void;
  /** Framework-injected — the live perp popup handle. */
  popup: PreactDialogHandle;
}

export function ProvidedPerpPopup({ vm, onClose, popup }: ProvidedPerpPopupProps) {
  const [page, setPage] = useState(0);
  const [openKey, setOpenKey] = useState<number | null>(null);
  // The `.standalone` selector doesn't fill `.PopupContent`, so the
  // closing subpop would reveal its white gradient as a flash. Mark
  // the body `.subpopClosing` for the close-transition window (CSS
  // drops `.PopupContent`'s white only while this is set); `.PopupBody`
  // is opaque white at rest, matching the legacy perp-buy popup.
  const [subpopClosing, setSubpopClosing] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const clearCloseTimer = (): void => {
    if (closeTimer.current !== undefined) {
      clearTimeout(closeTimer.current);
      closeTimer.current = undefined;
    }
  };
  useEffect(
    () => () => {
      if (closeTimer.current !== undefined) clearTimeout(closeTimer.current);
    },
    []
  );

  const openSubpop = (key: number): void => {
    clearCloseTimer();
    setSubpopClosing(false);
    setOpenKey(key);
  };
  // 250ms > the 0.2s `.SubpopContainer`/`.Subpop` close transition, so
  // the white only returns once the subpop is fully gone.
  const closeSubpop = (): void => {
    setOpenKey(null);
    setSubpopClosing(true);
    clearCloseTimer();
    closeTimer.current = setTimeout(() => setSubpopClosing(false), 250);
  };

  const pageCount = Math.max(1, Math.ceil(vm.tiles.length / vm.pageSize));
  const pageTiles = vm.tiles.slice(page * vm.pageSize, page * vm.pageSize + vm.pageSize);

  const closeX = (e: JSX.TargetedMouseEvent<HTMLDivElement>): void => {
    e.stopPropagation();
    onClose();
  };

  return (
    <div class={subpopClosing ? 'PopupBody ProvidedPerp subpopClosing' : 'PopupBody ProvidedPerp'}>
      <div class="PopupHeader">
        {/* biome-ignore lint/a11y/useKeyWithClickEvents: legacy DOM structure, keyboard support is a separate a11y pass */}
        <div class="PopupClose" onClick={closeX}>
          X
        </div>
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: locally produced sprite markup */}
        <div class="PopupLogo" dangerouslySetInnerHTML={{ __html: vm.spriteHtml }} />
        <div class="PopupTitle">{vm.title}</div>
        <div class="PopupSubTitle">{vm.subtitle}</div>
        <div class="PopupText">{vm.description}</div>
      </div>
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
          <div class="Pagination Selector standalone">
            <div class="SubpopHeader">
              <div class="SubpopHeaderTitle">{vm.selectorTitle}</div>
            </div>
            <div class="PopupSelector">
              <div class="PopupPageWrap">
                {vm.tiles.length === 0 ? (
                  <NoItems
                    loading={vm.loading}
                    textNoItems={vm.noItemsText}
                    textLoading={vm.loadingText}
                  />
                ) : (
                  <div class="PopupPage PerpPage" data-page-id={page}>
                    {pageTiles.map((t) => (
                      <PerpProvidedTile key={t.key} tile={t} onOpen={openSubpop} />
                    ))}
                  </div>
                )}
              </div>
            </div>
            <PageArrows page={page} pageCount={pageCount} setPage={setPage} standalone />
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
