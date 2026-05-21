import { span, sprintf, toKSNum } from '../../dd-helpers.js';
import i18n from '../../i18n.js';
import { PopupShell } from './PopupShell.js';

export interface XPStatusPopupProps {
  xpLevel: number;
  xpValue: number;
  xpMax: number;
  onClose: () => void;
}

export function XPStatusPopup({ xpLevel, xpValue, xpMax, onClose }: XPStatusPopupProps) {
  const subtitleHtml = sprintf(i18n.gettext('sb_XP subtitle Level %s'), span(toKSNum(xpLevel)));
  const descriptionHtml = sprintf(
    i18n.gettext('sb_XP description %s XP until next level'),
    span(toKSNum(xpMax - xpValue))
  );
  return (
    <PopupShell
      spriteClass="XP"
      bodyClass="Status"
      title={i18n.gettext('sb_XP title')}
      buttonLabel={i18n.gettext('Close')}
      onClose={onClose}
    >
      {/* biome-ignore lint/security/noDangerouslySetInnerHtml: trusted i18n catalog string */}
      <div class="PopupSubTitle" dangerouslySetInnerHTML={{ __html: subtitleHtml }} />
      {/* biome-ignore lint/security/noDangerouslySetInnerHtml: trusted i18n catalog string */}
      <div class="PopupText" dangerouslySetInnerHTML={{ __html: descriptionHtml }} />
    </PopupShell>
  );
}
