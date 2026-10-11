// Database profileset-import popup — Preact port of
// `views/popup_profileset.html` (computed in `game/profilesetView.ts`).
// Issue #80 phase 2 tier 10.  A trimmed popup_contact: the shared
// token grid / subpop / pagination (perpShared) + a single Profiles
// summary and one Import MainButton (routed through the same
// `fireAction` seam, wired to `Database.mergeCued`).

import type { ProfileSetPopupVM } from '../../game/profilesetView.js';
import { PopupHeader } from './PopupHeader.js';
import type { PreactDialogHandle } from './dialogManager.js';
import { TokenTab, fireAction } from './perpShared.js';

export interface ProfileSetPopupProps {
  vm: ProfileSetPopupVM;
  /** Framework-injected by the dialog manager. */
  onClose: () => void;
  /** Framework-injected — the live popup handle. */
  popup: PreactDialogHandle;
}

export function ProfileSetPopup({ vm, onClose, popup }: ProfileSetPopupProps) {
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
        <TokenTab tokens={vm.tokens} summaryProfiles={vm.summaryProfiles} />
      </div>
      {/* The button bar renders as a direct child of `.PopupBody`, outside
          the scrolling, rounded `.PopupContent`, so it straddles the
          dialog's bottom edge without WebKit clipping the overhang to
          `.PopupContent`'s border-radius. */}
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
  );
}
