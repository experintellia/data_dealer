// Client perp popup — Preact port of `views/popup_client.html` +
// `profileset_client.html` (issue #80 phase 2 tier 5b).  Two paged
// token grids ("provided" 7/page + "consumed" 6/page) split by a
// ClientDivider, a single Cash/Penalty income summary, and the same
// Charge/Collect button seam as Contact.  Token tile / subpop /
// arrows / action seam are the shared `perpShared.tsx`.

import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import type { ClientPopupVM } from '../../game/clientView.js';
import type { TokenVM } from '../../game/tokenView.js';
import i18n from '../../i18n.js';
import type { PreactDialogHandle } from './dialogManager.js';
import { PageArrows, TokenSubpop, TokenTile, fireAction } from './perpShared.js';

export interface ClientPopupProps {
  vm: ClientPopupVM;
  /** Framework-injected by the dialog manager. */
  onClose: () => void;
  /** Framework-injected — the live perp popup handle. */
  popup: PreactDialogHandle;
}

/** One paged token grid — `profileset_client.html` renders the blue
 *  "provided" set and the orange "consumed" set with the same markup,
 *  differing only in the wrapper classes and page size. */
function TokenGrid({
  tokens,
  pageSize,
  paginationClass,
  tokensClass,
  onOpen,
}: {
  tokens: TokenVM[];
  pageSize: number;
  paginationClass: string;
  tokensClass: string;
  onOpen: (gestalt: string) => void;
}) {
  const [page, setPage] = useState(0);
  const pageCount = Math.max(1, Math.ceil(tokens.length / pageSize));
  const pageTokens = tokens.slice(page * pageSize, page * pageSize + pageSize);
  return (
    <div class={paginationClass}>
      <div class={tokensClass}>
        <div class="PopupPageWrap">
          <div class="PopupPage" data-page-id={page}>
            {pageTokens.map((t) => (
              <TokenTile key={t.gestalt} token={t} onOpen={onOpen} />
            ))}
          </div>
        </div>
      </div>
      <PageArrows page={page} pageCount={pageCount} setPage={setPage} />
    </div>
  );
}

export function ClientPopup({ vm, onClose, popup }: ClientPopupProps) {
  const [openToken, setOpenToken] = useState<string | null>(null);

  const closeX = (e: JSX.TargetedMouseEvent<HTMLDivElement>): void => {
    e.stopPropagation();
    onClose();
  };

  return (
    <div class="PopupBody">
      <div class="PopupHeader">
        {/* biome-ignore lint/a11y/useKeyWithClickEvents: legacy DOM structure, keyboard support is a separate a11y pass */}
        <div class="PopupClose" onClick={closeX}>
          X
        </div>
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: locally produced sprite markup */}
        <div class="PopupLogo" dangerouslySetInnerHTML={{ __html: vm.spriteHtml }} />
        <div class="PopupTitle">{vm.title}</div>
        <div class="PopupText">{vm.description}</div>
      </div>
      <div class="PopupContent">
        <div class="PopupTab">
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
          <TokenGrid
            tokens={vm.providedTokens}
            pageSize={vm.providedPageSize}
            paginationClass="Pagination half small"
            tokensClass="PopupTokens provided"
            onOpen={setOpenToken}
          />
          <div class="ClientDivider">
            {Array.from({ length: vm.dividerCount }, (_, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: fixed positional divider dots, no reordering
              <div class="ClientDividerItem" key={i} />
            ))}
          </div>
          <TokenGrid
            tokens={vm.consumedTokens}
            pageSize={vm.consumedPageSize}
            paginationClass="Pagination half"
            tokensClass="PopupTokens consumed"
            onOpen={setOpenToken}
          />
          {/* `.PopupSummary` is emitted by profileset_client.html, so
              it stays inside `.PopupTab`. */}
          <div class="PopupSummary">
            <div class={`PopupSummaryItem ${vm.summaryClass}`}>
              <div class="RenderSprite Tobi" />
              {/* biome-ignore lint/security/noDangerouslySetInnerHtml: locally produced income markup (penalty span) */}
              <span dangerouslySetInnerHTML={{ __html: vm.summaryHtml }} />
            </div>
          </div>
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
