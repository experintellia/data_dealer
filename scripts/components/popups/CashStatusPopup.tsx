import { render } from 'preact';
import { sprintf, toKSNum } from '../../dd-helpers.js';
import i18n from '../../i18n.js';
import { PopupShell } from './PopupShell.js';

export interface CashStatusPopupProps {
  cashValue: number;
}

export function CashStatusPopup({ cashValue }: CashStatusPopupProps) {
  // The catalog wraps the value in `<span class="highlight">` for some
  // locales (en_US) and not others (de_AT drops the span entirely),
  // so the formatted result is HTML and goes through
  // `dangerouslySetInnerHTML` to match the legacy `<%= subtitle %>`.
  const subtitleHtml = sprintf(
    i18n.gettext('sb_cash subtitle <span class="highlight">$%s</span>'),
    toKSNum(cashValue)
  );
  return (
    <PopupShell
      spriteClass="Cash"
      bodyClass="Status"
      title={i18n.gettext('sb_cash title')}
      buttonLabel={i18n.gettext('Close')}
    >
      {/* biome-ignore lint/security/noDangerouslySetInnerHtml: trusted i18n catalog string */}
      <div class="PopupSubTitle" dangerouslySetInnerHTML={{ __html: subtitleHtml }} />
      <div class="PopupText">{i18n.gettext('sb_cash description')}</div>
    </PopupShell>
  );
}

export function mountCashStatusPopup(container: HTMLElement, props: CashStatusPopupProps): void {
  render(<CashStatusPopup {...props} />, container);
}
