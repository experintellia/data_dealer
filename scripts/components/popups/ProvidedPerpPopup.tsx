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
  // The key of the subpop currently animating out (~0.25s). Only that
  // specific card + its container get the close-transparency — not the
  // body, and not every mounted/stacked subpop — so a closing card
  // vanishes over the blue selector with no white flash while anything
  // else on screen stays opaque white.
  const [closingKey, setClosingKey] = useState<number | null>(null);
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
    setClosingKey(null);
    setOpenKey(key);
  };
  // 250ms > the 0.2s `.Subpop`/`.SubpopContainer` close transition, so
  // the card is fully gone before the close-transparency lifts.
  const closeSubpop = (): void => {
    const closing = openKey;
    setOpenKey(null);
    setClosingKey(closing);
    clearCloseTimer();
    closeTimer.current = setTimeout(() => setClosingKey(null), 250);
  };

  const pageCount = Math.max(1, Math.ceil(vm.tiles.length / vm.pageSize));
  const pageTiles = vm.tiles.slice(page * vm.pageSize, page * vm.pageSize + vm.pageSize);

  const closeX = (e: JSX.TargetedMouseEvent<HTMLDivElement>): void => {
    e.stopPropagation();
    onClose();
  };

  return (
    <div class="PopupBody ProvidedPerp">
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
              the legacy SubpopContainer reveal — no grid re-render).
              `.closing` marks just this container during its own
              card's ~0.25s close. */}
          <div
            class={`SubpopContainer${openKey !== null ? ' open' : ''}${
              closingKey !== null ? ' closing' : ''
            }`}
          >
            {vm.subpops.map((s) => (
              <PerpProvidedSubpop
                key={s.key}
                subpop={s}
                isOpen={openKey === s.key}
                isClosing={closingKey === s.key}
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
