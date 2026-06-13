// Client perp popup — Preact port of `views/popup_client.html` +
// `profileset_client.html` (issue #80 phase 2 tier 5b).  Two token
// grids (provided + consumed) split by a ClientDivider, a single
// Cash/Penalty income summary, and the same Charge/Collect button
// seam as Contact.  Token tile / subpop / grid / action seam are
// the shared `perpShared.tsx`.

import { useCallback, useState } from 'preact/hooks';
import type { ClientPopupVM } from '../../game/clientView.js';
import i18n from '../../i18n.js';
import { PopupHeader } from './PopupHeader.js';
import type { PreactDialogHandle } from './dialogManager.js';
import {
  TokenGrid,
  TokenSubpop,
  TokenSubpopDialog,
  fireAction,
  isMobileWidth,
  openSubpopDialog,
} from './perpShared.js';

export interface ClientPopupProps {
  vm: ClientPopupVM;
  /** Framework-injected by the dialog manager. */
  onClose: () => void;
  /** Framework-injected — the live perp popup handle. */
  popup: PreactDialogHandle;
}

export function ClientPopup({ vm, onClose, popup }: ClientPopupProps) {
  const [openToken, setOpenToken] = useState<string | null>(null);

  const handleOpenToken = useCallback(
    (gestalt: string) => {
      if (isMobileWidth()) {
        const token =
          vm.providedTokens.find((t) => t.gestalt === gestalt) ??
          vm.consumedTokens.find((t) => t.gestalt === gestalt);
        if (token) openSubpopDialog(TokenSubpopDialog, { token });
      } else {
        setOpenToken(gestalt);
      }
    },
    [vm.providedTokens, vm.consumedTokens],
  );

  return (
    <div class="PopupBody">
      <PopupHeader
        onClose={onClose}
        spriteHtml={vm.spriteHtml}
        title={vm.title}
        description={vm.description}
      />
      <div class="PopupContent">
        <div class={openToken ? 'PopupTab hasPopup' : 'PopupTab'}>
          {/* SubpopContainer holds the subpops for BOTH token sets
              (legacy profileset_client.html); only `.open` toggles. */}
          <div class={openToken ? 'SubpopContainer open' : 'SubpopContainer'}>
            {[...vm.providedTokens, ...vm.consumedTokens].map((t, i) => (
              <TokenSubpop
                // Provided/consumed gestalt sets can collide; key by
                // position so Preact has a stable unique key (open
                // state still matches the legacy data-subpop-id).
                key={`${i}-${t.gestalt}`}
                token={t}
                isOpen={openToken === t.gestalt}
                onClose={() => setOpenToken(null)}
              />
            ))}
          </div>
          {/* `.PopupSummary` is emitted by profileset_client.html, so it
              stays inside `.PopupTab` — but renders before the grids so
              the income chip sits *above* them.  Desktop pins it absolute
              (`.PopupSummary { top:192px }`, held on top of the grid by
              `z-index:1`); mobile flows it static, where this earlier DOM
              position is what stacks it above the grid — parity with the
              desktop layout. */}
          <div class="PopupSummary">
            <div class={`PopupSummaryItem ${vm.summaryClass}`}>
              <div class="RenderSprite Tobi" />
              {/* biome-ignore lint/security/noDangerouslySetInnerHtml: locally produced income markup (penalty span) */}
              <span dangerouslySetInnerHTML={{ __html: vm.summaryHtml }} />
            </div>
          </div>
          <TokenGrid
            tokens={vm.providedTokens}
            paginationClass="Pagination half small"
            tokensClass="PopupTokens provided"
            onOpen={handleOpenToken}
          />
          <div class="ClientDivider">
            {Array.from({ length: vm.dividerCount }, (_, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: fixed positional divider dots, no reordering
              <div class="ClientDividerItem" key={i} />
            ))}
          </div>
          <TokenGrid
            tokens={vm.consumedTokens}
            paginationClass="Pagination half"
            tokensClass="PopupTokens consumed"
            onOpen={handleOpenToken}
          />
        </div>
        {/* `.PopupButtons` is a sibling of `.PopupTab` in
            popup_client.html (the tab closes before the button bar),
            unlike popup_contact.html where it nests inside. */}
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
  );
}
