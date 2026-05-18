// TokenPerp popup — Preact port of `views/popup_token.html`
// (+ profileset_token / subpop_token_upgrade), computed in
// `game/tokenPopupView.ts`.  Issue #80 phase 2 tier 11.  Two layouts
// keyed by `vm.isSuper`: a bare header + Close (normal token), or the
// SuperToken profileset grid + Compute/Update footer.  Reuses the
// shared TokenTile/PageArrows/fireAction + the new TokenUpgradeSubpop.

import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import type { TokenPopupVM } from '../../game/tokenPopupView.js';
import type { PreactDialogHandle } from './dialogManager.js';
import { PageArrows, TokenTile, TokenUpgradeSubpop, fireAction } from './perpShared.js';

export interface TokenPopupProps {
  vm: TokenPopupVM;
  /** Framework-injected by the dialog manager. */
  onClose: () => void;
  /** Framework-injected — the live perp popup handle. */
  popup: PreactDialogHandle;
}

export function TokenPopup({ vm, onClose, popup }: TokenPopupProps) {
  const [page, setPage] = useState(0);
  const [openToken, setOpenToken] = useState<string | null>(null);

  const pageCount = Math.max(1, Math.ceil(vm.tokens.length / vm.pageSize));
  const pageTokens = vm.tokens.slice(page * vm.pageSize, page * vm.pageSize + vm.pageSize);

  const closeX = (e: JSX.TargetedMouseEvent<HTMLDivElement>): void => {
    e.stopPropagation();
    onClose();
  };

  return (
    <div class={vm.isSuper ? 'PopupBody TokenPerp SuperToken' : 'PopupBody TokenPerp'}>
      <div class="PopupHeader">
        {/* biome-ignore lint/a11y/useKeyWithClickEvents: legacy DOM structure, keyboard support is a separate a11y pass */}
        <div class="PopupClose" onClick={closeX}>
          X
        </div>
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: locally produced sprite markup */}
        <div class="PopupLogo" dangerouslySetInnerHTML={{ __html: vm.spriteHtml }} />
        <div class="PopupTitle">{vm.title}</div>
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: raw ruleset HTML (legacy <% print %>) */}
        <div class="PopupSubTitle" dangerouslySetInnerHTML={{ __html: vm.subtitleHtml }} />
        <div class="PopupText">{vm.description}</div>
        {vm.isSuper ? null : (
          <div class="PopupButtons">
            {/* biome-ignore lint/a11y/useKeyWithClickEvents: legacy DOM structure, keyboard support is a separate a11y pass */}
            <div
              class="Button"
              data-button-id="MainButton"
              onClick={(e) => fireAction(popup, e, 'MainButton')}
            >
              {vm.closeButtonText}
            </div>
          </div>
        )}
      </div>
      {vm.isSuper ? (
        <div class="PopupContent">
          <div class="PopupTab">
            <div class={openToken ? 'SubpopContainer half open' : 'SubpopContainer half'}>
              {vm.upgradeSubpops.map((s) => (
                <TokenUpgradeSubpop
                  key={s.subpopId}
                  sub={s}
                  isOpen={openToken !== null && s.subpopId === `token${openToken}`}
                  onClose={() => setOpenToken(null)}
                />
              ))}
            </div>
            <div class="Pagination half">
              <div class="PopupTokens">
                <div class="PopupPageWrap">
                  <div class="PopupPage" data-page-id={page}>
                    {pageTokens.map((t) => (
                      <TokenTile key={t.gestalt} token={t} onOpen={setOpenToken} />
                    ))}
                  </div>
                </div>
              </div>
              <PageArrows page={page} pageCount={pageCount} setPage={setPage} />
            </div>
            <div class="PopupSummary half">
              <div class="PopupSummaryItem Profiles">
                <div class="RenderSprite Tobi" />
                {vm.summaryLabel}
              </div>
            </div>
            {vm.collectMode ? (
              <div class="PopupButtons">
                <div class="ButtonDecorator AP">
                  <div class="RenderSprite Tobi" />1
                </div>
                {/* biome-ignore lint/a11y/useKeyWithClickEvents: legacy DOM structure, keyboard support is a separate a11y pass */}
                <div
                  class="Button"
                  data-button-id="CollectButton"
                  data-testid="dd-collect-button"
                  onClick={(e) => fireAction(popup, e, 'CollectButton')}
                >
                  {vm.collectButtonText}
                </div>
              </div>
            ) : (
              <div class="PopupButtons">
                <div class="ButtonDecorator AP">
                  <div class="RenderSprite Tobi" />1
                </div>
                {/* biome-ignore lint/a11y/useKeyWithClickEvents: legacy DOM structure, keyboard support is a separate a11y pass */}
                <div
                  class={vm.chargeDisabled ? 'Button disabled' : 'Button'}
                  data-button-id="ChargeButton"
                  data-testid="dd-charge-button"
                  onClick={(e) => fireAction(popup, e, 'ChargeButton')}
                >
                  {vm.chargeButtonText}
                </div>
                <div class="ButtonDecorator Time">
                  <div class="RenderSprite Tobi" />
                  {vm.chargeTimeText}
                </div>
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
