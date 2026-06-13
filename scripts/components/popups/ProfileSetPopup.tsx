// Database profileset-import popup — Preact port of
// `views/popup_profileset.html` (computed in `game/profilesetView.ts`).
// Issue #80 phase 2 tier 10.  A trimmed popup_contact: the shared
// token grid / subpop / pagination (perpShared) + a single Profiles
// summary and one Import MainButton (routed through the same
// `fireAction` seam, wired to `Database.mergeCued`).

import { useCallback, useState } from 'preact/hooks';
import type { ProfileSetPopupVM } from '../../game/profilesetView.js';
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

export interface ProfileSetPopupProps {
  vm: ProfileSetPopupVM;
  /** Framework-injected by the dialog manager. */
  onClose: () => void;
  /** Framework-injected — the live popup handle. */
  popup: PreactDialogHandle;
}

export function ProfileSetPopup({ vm, onClose, popup }: ProfileSetPopupProps) {
  const [openToken, setOpenToken] = useState<string | null>(null);

  const handleOpenToken = useCallback(
    (gestalt: string) => {
      if (isMobileWidth()) {
        const token = vm.tokens.find((t) => t.gestalt === gestalt);
        if (token) openSubpopDialog(TokenSubpopDialog, { token });
      } else {
        setOpenToken(gestalt);
      }
    },
    [vm.tokens],
  );

  return (
    <div class="PopupBody">
      <PopupHeader
        onClose={onClose}
        spriteHtml={vm.spriteHtml}
        title={vm.title}
        subtitle={vm.subtitle}
        description={vm.description}
      />
      <div class="PopupContent">
        <div class={openToken ? 'PopupTab hasPopup' : 'PopupTab'}>
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
          {/* The profiles summary renders before the grid so it sits
              *above* it.  Desktop pins the chip absolute
              (`.PopupSummary { top:192px }`, held on top of the grid by
              `z-index:1`); mobile flows it static, where this earlier
              DOM position is what stacks it above the grid — parity with
              the desktop layout. */}
          <div class="PopupSummary">
            <div class="PopupSummaryItem Profiles">
              <div class="RenderSprite Tobi" />
              {vm.summaryProfiles}
            </div>
          </div>
          <TokenGrid
            tokens={vm.tokens}
            paginationClass="Pagination"
            tokensClass="PopupTokens"
            onOpen={handleOpenToken}
          />
          <div class="PopupButtons">
            <div class="ButtonDecorator AP">
              <div class="RenderSprite Tobi" />1
            </div>
            {/* biome-ignore lint/a11y/useKeyWithClickEvents: legacy DOM structure, keyboard support is a separate a11y pass */}
            <div
              class="Button"
              data-button-id="MainButton"
              data-testid="dd-integrate-button"
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
