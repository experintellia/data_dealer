// TokenPerp popup — Preact port of `views/popup_token.html`
// (+ profileset_token / subpop_token_upgrade), computed in
// `game/tokenPopupView.ts`.  Issue #80 phase 2 tier 11.  Two layouts
// keyed by `vm.isSuper`: a bare header + Close (normal token), or the
// SuperToken profileset grid + Compute/Update footer.  Reuses the
// shared TokenTile/TokenGrid/fireAction + the TokenUpgradeSubpop.

import { useCallback, useState } from 'preact/hooks';
import type { TokenPopupVM } from '../../game/tokenPopupView.js';
import { PopupHeader } from './PopupHeader.js';
import type { PreactDialogHandle } from './dialogManager.js';
import {
  TokenGrid,
  TokenUpgradeSubpop,
  TokenUpgradeSubpopDialog,
  fireAction,
  isMobileWidth,
  openSubpopDialog,
} from './perpShared.js';

export interface TokenPopupProps {
  vm: TokenPopupVM;
  /** Framework-injected by the dialog manager. */
  onClose: () => void;
  /** Framework-injected — the live perp popup handle. */
  popup: PreactDialogHandle;
}

export function TokenPopup({ vm, onClose, popup }: TokenPopupProps) {
  const [openToken, setOpenToken] = useState<string | null>(null);
  const handleOpenToken = useCallback(
    (gestalt: string) => {
      if (isMobileWidth()) {
        const sub = vm.upgradeSubpops.find((s) => s.subpopId === `token${gestalt}`);
        if (sub) openSubpopDialog(TokenUpgradeSubpopDialog, { sub });
      } else {
        setOpenToken(gestalt);
      }
    },
    [vm.upgradeSubpops]
  );

  return (
    <div class={vm.isSuper ? 'PopupBody TokenPerp SuperToken' : 'PopupBody TokenPerp'}>
      <PopupHeader
        onClose={onClose}
        spriteHtml={vm.spriteHtml}
        title={vm.title}
        subtitleHtml={vm.subtitleHtml}
        description={vm.description}
      >
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
      </PopupHeader>
      {vm.isSuper ? (
        <div class="PopupContent">
          <div class={openToken ? 'PopupTab hasPopup' : 'PopupTab'}>
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
            <div class="PopupSummary half">
              <div class="PopupSummaryItem Profiles">
                <div class="RenderSprite Tobi" />
                {vm.summaryLabel}
              </div>
            </div>
            <TokenGrid
              tokens={vm.tokens}
              paginationClass="Pagination half"
              tokensClass="PopupTokens"
              onOpen={handleOpenToken}
            />
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
