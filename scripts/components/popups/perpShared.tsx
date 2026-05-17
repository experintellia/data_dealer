// Shared perp-popup pieces — the token tile, the detail subpop, the
// pagination arrows, and the action-button click bridge.  popup_contact
// (tier 5a) and popup_client (tier 5b) render the same `token.html` /
// `subpop_token.html` partials and route action buttons through the
// same legacy `popup.trigger('button_click.X')` seam, so these live
// once here instead of being duplicated per perp component.

import type { JSX } from 'preact';
import type { TokenVM } from '../../game/tokenView.js';
import i18n from '../../i18n.js';
import { type PreactDialogHandle, toFXTarget } from './dialogManager.js';

/** Fire the legacy `.Button` seam: park the clicked element +
 *  click point on the handle, then `popup.trigger('button_click.X')`
 *  (routed by `GameNode.initPopupEvents` to `Charge()`/`collect()`).
 *  No re-entrancy guard beyond the `.disabled` check — unlike the
 *  legacy `.Button:not(.active)` handler, the snapshot VM never
 *  re-renders, so engine idempotency is the sole guard for a
 *  double-tap before an async resolve (fine for the synchronous
 *  local engine). */
export function fireAction(
  popup: PreactDialogHandle,
  e: JSX.TargetedMouseEvent<HTMLDivElement>,
  buttonId: string
): void {
  e.stopPropagation();
  if (e.currentTarget.classList.contains('disabled')) return;
  popup.lastButton = toFXTarget(e.currentTarget);
  popup.lastButtonPoint = { x: e.clientX, y: e.clientY };
  popup.trigger(`button_click.${buttonId}`);
}

export function TokenTile({
  token,
  onOpen,
}: {
  token: TokenVM;
  onOpen: (gestalt: string) => void;
}) {
  // Short locals keep the dangerouslySetInnerHTML lines single-line so
  // the biome-ignore attaches (codebase convention, see MissionPopup).
  const st = token.perpStyle;
  const sp = token.spriteHtml;
  const lb = token.labelHtml;
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: legacy DOM structure, keyboard support is a separate a11y pass
    <div
      class={token.locked ? 'PopupToken locked' : 'PopupToken'}
      data-subpop-id={`token${token.gestalt}`}
      onClick={() => !token.locked && onOpen(token.gestalt)}
    >
      {/* biome-ignore lint/security/noDangerouslySetInnerHtml: locally produced sprite markup */}
      <div class="PopupTokenPerp" style={st} dangerouslySetInnerHTML={{ __html: sp }} />
      {/* biome-ignore lint/security/noDangerouslySetInnerHtml: ruleset label via crlf2html */}
      <div class="PopupTokenLabel" dangerouslySetInnerHTML={{ __html: lb }} />
    </div>
  );
}

export function TokenSubpop({
  token,
  isOpen,
  onClose,
}: {
  token: TokenVM;
  isOpen: boolean;
  onClose: () => void;
}) {
  const close = (e: JSX.TargetedMouseEvent<HTMLDivElement>): void => {
    e.stopPropagation();
    onClose();
  };
  const sub = token.subpop.subTitleHtml;
  return (
    <div class={isOpen ? 'Subpop open' : 'Subpop'} data-subpop-id={`token${token.gestalt}`}>
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

/** The legacy `.Pagination` prev/next arrows — both perp grids (and
 *  Client's two half-grids) share the same `.hidden`-toggle markup. */
export function PageArrows({
  page,
  pageCount,
  setPage,
}: {
  page: number;
  pageCount: number;
  setPage: (next: (p: number) => number) => void;
}) {
  if (pageCount <= 1) return null;
  return (
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
  );
}
