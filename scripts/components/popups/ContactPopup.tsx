// Contact perp popup — Preact port of `views/popup_contact.html`
// (+ profileset partial, computed in `scripts/game/contactView.ts`).
// Issue #80 phase 2 tier 5a.  Token tile / subpop / pagination /
// action-button seam live in `perpShared.tsx` (shared with Client).

import type { ContactPopupVM } from '../../game/contactView.js';
import { PopupHeader } from './PopupHeader.js';
import type { PreactDialogHandle } from './dialogManager.js';
import { ChargeCollectButtons, TokenTab } from './perpShared.js';

export interface ContactPopupProps {
  vm: ContactPopupVM;
  /** Framework-injected by the dialog manager. */
  onClose: () => void;
  /** Framework-injected — the live perp popup handle. */
  popup: PreactDialogHandle;
}

export function ContactPopup({ vm, onClose, popup }: ContactPopupProps) {
  return (
    <div class="PopupBody ContactPerp">
      <PopupHeader
        onClose={onClose}
        spriteHtml={vm.spriteHtml}
        title={vm.title}
        description={vm.description}
      />
      <div class="PopupContent">
        <TokenTab
          tokens={vm.tokens}
          summaryProfiles={vm.summaryProfiles}
          summaryRisk={vm.summaryRisk}
          summaryRiskUp={vm.summaryRiskUp}
        />
      </div>
      {/* The button bar renders as a direct child of `.PopupBody`, outside
          the scrolling, rounded `.PopupContent`, so it straddles the
          dialog's bottom edge without WebKit clipping the overhang to
          `.PopupContent`'s border-radius. */}
      <ChargeCollectButtons
        popup={popup}
        collectMode={vm.collectMode}
        chargeDisabled={vm.chargeDisabled}
        chargeText={vm.buttonText}
        chargeTimeText={vm.chargeTimeText}
        chargeCostText={vm.chargeCostText}
      />
    </div>
  );
}
