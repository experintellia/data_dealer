// Shared perp-popup pieces — the token tile, the detail subpop, the
// pagination arrows, and the action-button click bridge.  popup_contact
// (tier 5a) and popup_client (tier 5b) render the same `token.html` /
// `subpop_token.html` partials and route action buttons through the
// same legacy `popup.trigger('button_click.X')` seam, so these live
// once here instead of being duplicated per perp component.

import type { JSX } from 'preact';
import type { ProvidedSubpopVM, ProvidedTileVM } from '../../game/providedView.js';
import type { TokenUpgradeSubpopVM } from '../../game/tokenPopupView.js';
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
  buttonId: string,
  args?: unknown[]
): void {
  e.stopPropagation();
  if (e.currentTarget.classList.contains('disabled')) return;
  popup.lastButton = toFXTarget(e.currentTarget);
  popup.lastButtonPoint = { x: e.clientX, y: e.clientY };
  // Legacy `.Button` handler forwards `[data-button-gestalt,
  // data-button-data]`; buy buttons (PerpBuyButton) need the gestalt.
  popup.trigger(`button_click.${buttonId}`, args);
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
  standalone,
}: {
  page: number;
  pageCount: number;
  setPage: (next: (p: number) => number) => void;
  /** Pusher/Proxy selectors use `.PopupPageArrowR.standalone`. */
  standalone?: boolean;
}) {
  if (pageCount <= 1) return null;
  const sa = standalone ? ' standalone' : '';
  return (
    <>
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: legacy DOM structure, keyboard support is a separate a11y pass */}
      <div
        class={page < pageCount - 1 ? `PopupPageArrowR${sa}` : `PopupPageArrowR${sa} hidden`}
        onClick={() => setPage((p) => Math.min(p + 1, pageCount - 1))}
      />
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: legacy DOM structure, keyboard support is a separate a11y pass */}
      <div
        class={page > 0 ? `PopupPageArrowL${sa}` : `PopupPageArrowL${sa} hidden`}
        onClick={() => setPage((p) => Math.max(p - 1, 0))}
      />
    </>
  );
}

/** One provided-perp grid tile (`client.html` / `perp.html`).  Opens
 *  its detail subpop by the legacy row key (`data-subpop-id`). */
export function PerpProvidedTile({
  tile,
  onOpen,
}: {
  tile: ProvidedTileVM;
  onOpen: (key: number) => void;
}) {
  const ps = tile.perpStyle;
  const rp = tile.renderPerpHtml;
  const lb = tile.labelHtml;
  const dh = tile.dataHtml;
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: legacy DOM structure, keyboard support is a separate a11y pass
    <div
      class={`PopupPerp provided${tile.locked ? ' locked' : ''}${tile.extraClass}`}
      data-subpop-id={tile.key}
      data-gestalt={tile.gestalt}
      onClick={() => !tile.locked && onOpen(tile.key)}
    >
      {/* biome-ignore lint/security/noDangerouslySetInnerHtml: locally produced sprite markup */}
      <div class="RenderPerp" style={ps} dangerouslySetInnerHTML={{ __html: rp }} />
      {/* biome-ignore lint/security/noDangerouslySetInnerHtml: ruleset label via crlf2html */}
      <div class={tile.labelClass} dangerouslySetInnerHTML={{ __html: lb }} />
      <div class={tile.labelDataClass}>
        <div class="Price">
          <div class="Buy Cash" />
          {tile.priceText}
        </div>
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: locally produced values / requires markup */}
        <div style="display:contents" dangerouslySetInnerHTML={{ __html: dh }} />
      </div>
    </div>
  );
}

/** The buy detail subpop (`subpop_perp_provided.html`).  PerpBuyButton
 *  forwards its gestalt through the legacy `button_click` seam. */
export function PerpProvidedSubpop({
  subpop,
  isOpen,
  onClose,
  popup,
}: {
  subpop: ProvidedSubpopVM;
  isOpen: boolean;
  onClose: () => void;
  popup: PreactDialogHandle;
}) {
  const close = (e: JSX.TargetedMouseEvent<HTMLDivElement>): void => {
    e.stopPropagation();
    onClose();
  };
  const vd = subpop.valuesDetailsHtml;
  return (
    <div class={isOpen ? 'Subpop open' : 'Subpop'} data-subpop-id={subpop.key}>
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: legacy DOM structure, keyboard support is a separate a11y pass */}
      <div class="SubpopClose" data-button-id="CloseSubpop" onClick={close}>
        X
      </div>
      {/* biome-ignore lint/security/noDangerouslySetInnerHtml: locally produced sprite markup */}
      <div class="SubpopLogo" dangerouslySetInnerHTML={{ __html: subpop.logoHtml }} />
      <div class="SubpopTitle">{subpop.title}</div>
      {/* biome-ignore lint/security/noDangerouslySetInnerHtml: locally produced bonus markup */}
      <div class="PowerupLabelData SubpopLabelData" dangerouslySetInnerHTML={{ __html: vd }} />
      <div class="SubpopText">{subpop.description}</div>
      <div class="SubpopButtons">
        <div class="ButtonDecorator Cash">
          <div class="RenderSprite Tobi" />
          {subpop.priceText}
        </div>
        {/* biome-ignore lint/a11y/useKeyWithClickEvents: legacy DOM structure, keyboard support is a separate a11y pass */}
        <div
          class="Button"
          data-button-id="PerpBuyButton"
          data-button-gestalt={subpop.gestalt}
          data-testid={`dd-perp-buy-${subpop.gestalt}`}
          onClick={(e) => fireAction(popup, e, 'PerpBuyButton', [subpop.gestalt])}
        >
          {subpop.buyButtonText}
        </div>
      </div>
    </div>
  );
}

/** `noitems.html` — empty / loading state for a provided grid. */
export function NoItems({
  loading,
  textNoItems,
  textLoading,
}: {
  loading: boolean;
  textNoItems: string;
  textLoading: string;
}) {
  if (loading) {
    return (
      <div class="SelectorNoItems loading">
        <div class="LoadingSpinner" />
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: trusted i18n string (may contain <br />) */}
        <span dangerouslySetInnerHTML={{ __html: textLoading }} />
      </div>
    );
  }
  // biome-ignore lint/security/noDangerouslySetInnerHtml: trusted i18n string (may contain <br />)
  return <div class="SelectorNoItems" dangerouslySetInnerHTML={{ __html: textNoItems }} />;
}

/** `subpop_token_upgrade.html` — the SuperToken "analyzed / not yet
 *  analyzed" detail card.  Distinct from `TokenSubpop` (findings):
 *  `.Subpop.TokenUpgrade`, an OKButton close, no action button. */
export function TokenUpgradeSubpop({
  sub,
  isOpen,
  onClose,
}: {
  sub: TokenUpgradeSubpopVM;
  isOpen: boolean;
  onClose: () => void;
}) {
  const close = (e: JSX.TargetedMouseEvent<HTMLDivElement>): void => {
    e.stopPropagation();
    onClose();
  };
  return (
    <div
      class={isOpen ? 'Subpop TokenUpgrade open' : 'Subpop TokenUpgrade'}
      data-subpop-id={sub.subpopId}
    >
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: legacy DOM structure, keyboard support is a separate a11y pass */}
      <div class="SubpopClose" data-button-id="CloseSubpop" onClick={close}>
        X
      </div>
      {/* biome-ignore lint/security/noDangerouslySetInnerHtml: locally produced sprite markup */}
      <div class="SubpopLogo" dangerouslySetInnerHTML={{ __html: sub.logoHtml }} />
      <div class="SubpopTitle">{sub.title}</div>
      <div class="SubpopSubTitle">
        {sub.todoLabel} <span class="UpgradeTodo">{sub.todoText}</span>
        <br />
        {sub.doneLabel} <span class="UpgradeDone">{sub.doneText}</span>
      </div>
      <div class="SubpopText">{sub.description}</div>
      <div class="SubpopButtons">
        {/* biome-ignore lint/a11y/useKeyWithClickEvents: legacy DOM structure, keyboard support is a separate a11y pass */}
        <div class="Button" data-button-id="OKButton" onClick={close}>
          {i18n.gettext('Close')}
        </div>
      </div>
    </div>
  );
}
