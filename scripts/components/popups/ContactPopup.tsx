// Contact perp popup — Preact port of `views/popup_contact.html`
// (+ profileset partial, computed in `scripts/game/contactView.ts`).
// Issue #80 phase 2 tier 5a.  Token tile / subpop / pagination /
// action-button seam live in `perpShared.tsx` (shared with Client).

import { useState } from 'preact/hooks';
import type { ContactPopupVM } from '../../game/contactView.js';
import i18n from '../../i18n.js';
import { PopupHeader } from './PopupHeader.js';
import type { PreactDialogHandle } from './dialogManager.js';
import { TokenGrid, TokenSubpop, fireAction } from './perpShared.js';

export interface ContactPopupProps {
  vm: ContactPopupVM;
  /** Framework-injected by the dialog manager. */
  onClose: () => void;
  /** Framework-injected — the live perp popup handle. */
  popup: PreactDialogHandle;
}

export function ContactPopup({ vm, onClose, popup }: ContactPopupProps) {
  const [openToken, setOpenToken] = useState<string | null>(null);

  return (
    <div class="PopupBody ContactPerp">
      <PopupHeader
        onClose={onClose}
        spriteHtml={vm.spriteHtml}
        title={vm.title}
        description={vm.description}
      />
      <div class="PopupContent">
        <div class={openToken ? 'PopupTab hasPopup' : 'PopupTab'}>
          {/* All token subpops stay mounted (matches legacy
              profileset.html); only `.open` toggles, so the CSS
              scale/opacity transition plays and the grid underneath
              is never re-rendered (no white flash). */}
          <div class={openToken ? 'SubpopContainer open' : 'SubpopContainer'}>
            {vm.tokens.map((t) => (
              <TokenSubpop
                key={t.gestalt}
                token={t}
                isOpen={openToken === t.gestalt}
                onClose={() => setOpenToken(null)}
              />
            ))}
          </div>
          {/* The profiles/risk summary renders before the grid so it
              sits *above* it.  Desktop pins the chips absolute
              (`.PopupSummary { top:192px }`, held on top of the grid by
              `z-index:1`); mobile flows them static, where this earlier
              DOM position is what stacks them above the grid — parity
              with the desktop layout. */}
          <div class="PopupSummary">
            <div class="PopupSummaryItem Profiles">
              <div class="RenderSprite Tobi" />
              {vm.summaryProfiles}
            </div>
            <div class={`PopupSummaryItem Risk ${vm.summaryRiskUp ? 'Up' : 'Down'}`}>
              <div class="RenderSprite Tobi" />
              {vm.summaryRisk}
            </div>
          </div>
          <TokenGrid
            tokens={vm.tokens}
            paginationClass="Pagination"
            tokensClass="PopupTokens"
            onOpen={setOpenToken}
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
                {i18n.gettext('Collect')}
              </div>
            </div>
          ) : (
            <div class="PopupButtons">
              <div class="ButtonDecorator Cash">
                <div class="RenderSprite Tobi" />
                {vm.chargeCostText}
              </div>
              {/* biome-ignore lint/a11y/useKeyWithClickEvents: legacy DOM structure, keyboard support is a separate a11y pass */}
              <div
                class={vm.chargeDisabled ? 'Button disabled' : 'Button'}
                data-button-id="ChargeButton"
                data-testid="dd-charge-button"
                onClick={(e) => fireAction(popup, e, 'ChargeButton')}
              >
                {vm.buttonText}
              </div>
              <div class="ButtonDecorator Time">
                <div class="RenderSprite Tobi" />
                {vm.chargeTimeText}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
