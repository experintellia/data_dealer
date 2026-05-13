import { render } from 'preact';
import { span, sprintf, toKSNum } from '../../dd-helpers.js';
import i18n from '../../i18n.js';
import { PopupShell } from './PopupShell.js';

export interface XPStatusPopupProps {
  xpLevel: number;
  xpValue: number;
  xpMax: number;
}

export function XPStatusPopup({ xpLevel, xpValue, xpMax }: XPStatusPopupProps) {
  const subtitleHtml = sprintf(i18n.gettext('sb_XP subtitle Level %s'), span(toKSNum(xpLevel)));
  const descriptionHtml = sprintf(
    i18n.gettext('sb_XP description %s XP until next level'),
    span(toKSNum(xpMax - xpValue + 1))
  );
  return (
    <PopupShell
      spriteClass="XP"
      bodyClass="Status"
      title={i18n.gettext('sb_XP title')}
      buttonLabel={i18n.gettext('Close')}
    >
      {/* biome-ignore lint/security/noDangerouslySetInnerHtml: trusted i18n catalog string */}
      <div class="PopupSubTitle" dangerouslySetInnerHTML={{ __html: subtitleHtml }} />
      {/* biome-ignore lint/security/noDangerouslySetInnerHtml: trusted i18n catalog string */}
      <div class="PopupText" dangerouslySetInnerHTML={{ __html: descriptionHtml }} />
    </PopupShell>
  );
}

export function mountXPStatusPopup(container: HTMLElement, props: XPStatusPopupProps): void {
  render(<XPStatusPopup {...props} />, container);
}
