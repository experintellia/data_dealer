// Contact perp popup — Preact port of `views/popup_contact.html`
// (+ profileset / token / subpop_token partials, computed in
// `scripts/game/contactView.ts`).  Issue #80 phase 2 tier 5a.
//
// Action buttons fire `popup.trigger('button_click.ChargeButton')`
// etc. — exactly what the legacy jQuery `.Button` delegated handler
// did; `GameNode.initPopupEvents` (bound via the perp's
// `openPreactPopup`) routes it to `gnode.Charge()/collect()`.  Token
// detail subpop + token-grid pagination are Preact `useState`, not
// the legacy jQuery reveal/pagination handlers.

import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import type { ContactPopupVM, TokenVM } from '../../game/contactView.js';
import i18n from '../../i18n.js';
import type { PreactDialogHandle } from './dialogManager.js';

export interface ContactPopupProps {
  vm: ContactPopupVM;
  /** Framework-injected by the dialog manager. */
  onClose: () => void;
  /** Framework-injected — the live perp popup handle. */
  popup: PreactDialogHandle;
}

/** Wrap a button element as the handle's `lastButton` so the
 *  `no_cash` / `no_AP` / `error` FX (driven by `gnode.Charge()`)
 *  targets the button the player just clicked, mirroring the legacy
 *  jQuery handler's `node.lastButton = $(this)`. */
function asLastButton(el: HTMLElement): {
  addClass(s: string): void;
  removeClass(s: string): void;
} {
  return {
    addClass: (s) => {
      for (const c of s.split(' ')) if (c) el.classList.add(c);
    },
    removeClass: (s) => {
      for (const c of s.split(' ')) if (c) el.classList.remove(c);
    },
  };
}

function TokenTile({
  token,
  onOpen,
}: {
  token: TokenVM;
  onOpen: (gestalt: string) => void;
}) {
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: legacy DOM structure, keyboard support is a separate a11y pass
    <div
      class={token.locked ? 'PopupToken locked' : 'PopupToken'}
      data-subpop-id={`token${token.gestalt}`}
      onClick={() => !token.locked && onOpen(token.gestalt)}
    >
      <div class="PopupTokenPerp" style={token.perpStyle}>
        {token.isNew ? <div class="new">{i18n.gettext('New!')}</div> : null}
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: locally produced sprite markup */}
        <span dangerouslySetInnerHTML={{ __html: token.spriteHtml }} />
      </div>
      {/* biome-ignore lint/security/noDangerouslySetInnerHtml: ruleset label via crlf2html */}
      <div class="PopupTokenLabel" dangerouslySetInnerHTML={{ __html: token.labelHtml }} />
    </div>
  );
}

function TokenSubpop({ token, onClose }: { token: TokenVM; onClose: () => void }) {
  const close = (e: JSX.TargetedMouseEvent<HTMLDivElement>): void => {
    e.stopPropagation();
    onClose();
  };
  const sub = token.subpop.subTitleHtml;
  return (
    <div class="Subpop open" data-subpop-id={`token${token.gestalt}`}>
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: legacy DOM structure, keyboard support is a separate a11y pass */}
      <div class="SubpopClose" data-button-id="CloseSubpop" onClick={close}>
        X
      </div>
      {/* biome-ignore lint/security/noDangerouslySetInnerHtml: locally produced sprite markup */}
      <div class="SubpopLogo" dangerouslySetInnerHTML={{ __html: token.subpop.logoHtml }} />
      <div class="SubpopTitle">{token.subpop.title}</div>
      {sub ? (
        // biome-ignore lint/security/noDangerouslySetInnerHtml: ruleset findings/knowledge text
        <div class="SubpopSubTitle" dangerouslySetInnerHTML={{ __html: sub }} />
      ) : null}
      <div class="SubpopText">{token.subpop.description}</div>
      <div class="SubpopButtons">
        {/* biome-ignore lint/a11y/useKeyWithClickEvents: legacy DOM structure, keyboard support is a separate a11y pass */}
        <div class="Button" data-button-id="OKButton" onClick={close}>
          {i18n.gettext('Close')}
        </div>
      </div>
    </div>
  );
}

export function ContactPopup({ vm, onClose, popup }: ContactPopupProps) {
  const [page, setPage] = useState(0);
  const [openToken, setOpenToken] = useState<string | null>(null);

  const pageCount = Math.max(1, Math.ceil(vm.tokens.length / vm.pageSize));
  const pageTokens = vm.tokens.slice(page * vm.pageSize, page * vm.pageSize + vm.pageSize);
  const active = openToken ? vm.tokens.find((t) => t.gestalt === openToken) : undefined;

  const closeX = (e: JSX.TargetedMouseEvent<HTMLDivElement>): void => {
    e.stopPropagation();
    onClose();
  };
  const fireAction = (e: JSX.TargetedMouseEvent<HTMLDivElement>, buttonId: string): void => {
    e.stopPropagation();
    if (e.currentTarget.classList.contains('disabled')) return;
    popup.lastButton = asLastButton(e.currentTarget);
    popup.trigger(`button_click.${buttonId}`);
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
          <div class={active ? 'SubpopContainer open' : 'SubpopContainer'}>
            {active ? <TokenSubpop token={active} onClose={() => setOpenToken(null)} /> : null}
          </div>
          <div class="Pagination">
            <div class="PopupTokens">
              <div class="PopupPageWrap">
                <div class="PopupPage" data-page-id={page}>
                  {pageTokens.map((t) => (
                    <TokenTile key={t.gestalt} token={t} onOpen={setOpenToken} />
                  ))}
                </div>
              </div>
            </div>
            {pageCount > 1 ? (
              <>
                {/* biome-ignore lint/a11y/useKeyWithClickEvents: legacy DOM structure, keyboard support is a separate a11y pass */}
                <div
                  class={page < pageCount - 1 ? 'PopupPageArrowR' : 'PopupPageArrowR hidden'}
                  onClick={() => setPage((p) => Math.min(p + 1, pageCount - 1))}
                />
                {/* biome-ignore lint/a11y/useKeyWithClickEvents: legacy DOM structure, keyboard support is a separate a11y pass */}
                <div
                  class={page > 0 ? 'PopupPageArrowL' : 'PopupPageArrowL hidden'}
                  onClick={() => setPage((p) => Math.max(p - 1, 0))}
                />
              </>
            ) : null}
          </div>
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
                onClick={(e) => fireAction(e, 'CollectButton')}
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
                onClick={(e) => fireAction(e, 'ChargeButton')}
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
