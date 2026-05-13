// First Preact popup component — pipeline proof for the phase 2 port
// of `Render.Popup` (issue #80 phase 2; legacy template was the Cash
// branch of `views/popup_status.html`).  All click handling stays on
// the `RenderPopup` jQuery delegated handlers in RenderTopLevelUI.ts;
// this component only owns the DOM _content_.

import { render } from 'preact';

export interface CashStatusPopupProps {
  /** Pre-i18n title, e.g. "Cash". */
  title: string;
  /**
   * Pre-formatted subtitle HTML (gettext + sprintf already applied).
   * The legacy template wrote `<%= subtitle %>` (raw HTML), and the
   * en_US catalog wraps the value in `<span class="highlight">`; some
   * locales (de_AT) drop the span entirely.  Render via
   * `dangerouslySetInnerHTML` to keep behavior identical across
   * locales and avoid breaking the existing translations.
   */
  subtitleHtml: string;
  description: string;
  buttonLabel: string;
}

export function CashStatusPopup({
  title,
  subtitleHtml,
  description,
  buttonLabel,
}: CashStatusPopupProps) {
  return (
    <div class="PopupBody Status">
      <div class="PopupHeader">
        <div class="PopupClose">X</div>
        <div class="PopupLogo">
          <div class="MainSpritesPopup Cash" />
        </div>
        <div class="PopupTitle">{title}</div>
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: trusted i18n catalog string */}
        <div class="PopupSubTitle" dangerouslySetInnerHTML={{ __html: subtitleHtml }} />
        <div class="PopupText">{description}</div>
        <div class="PopupButtons">
          <div class="Button" data-button-id="MainButton">
            {buttonLabel}
          </div>
        </div>
      </div>
    </div>
  );
}

export function mountCashStatusPopup(container: HTMLElement, props: CashStatusPopupProps): void {
  render(<CashStatusPopup {...props} />, container);
}
