import { span, sprintf, toKSNum } from '../../dd-helpers.js';
import i18n from '../../i18n.js';
import { PopupShell } from './PopupShell.js';

export interface APStatusPopupProps {
  apValue: number;
  apMax: number;
  onClose: () => void;
}

export function APStatusPopup({ apValue, apMax, onClose }: APStatusPopupProps) {
  const subtitleHtml = sprintf(
    i18n.gettext('sb_AP subtitle %s/%s'),
    span(toKSNum(apValue)),
    span(toKSNum(apMax))
  );
  return (
    <PopupShell
      spriteClass="AP"
      bodyClass="Status"
      title={i18n.gettext('sb_AP title')}
      buttonLabel={i18n.gettext('Close')}
      onClose={onClose}
    >
      {/* biome-ignore lint/security/noDangerouslySetInnerHtml: trusted i18n catalog string */}
      <div class="PopupSubTitle" dangerouslySetInnerHTML={{ __html: subtitleHtml }} />
      <div class="PopupText">{i18n.gettext('sb_AP description')}</div>
    </PopupShell>
  );
}
