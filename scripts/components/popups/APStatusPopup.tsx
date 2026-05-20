import { span, sprintf, toKSNum, toTime } from '../../dd-helpers.js';
import i18n from '../../i18n.js';
import { PopupShell } from './PopupShell.js';

export interface APStatusPopupProps {
  apValue: number;
  apMax: number;
  /** Milliseconds until the next AP tick. Omit when AP is already full. */
  apRemaining?: number;
  onClose: () => void;
}

export function APStatusPopup({ apValue, apMax, apRemaining, onClose }: APStatusPopupProps) {
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
      {apValue < apMax && apRemaining !== undefined && (
        <div class="PopupText APRemain">
          {i18n.gettext('More Energy in')}{' '}
          <span class="highlight">{toTime(apRemaining)}</span>
        </div>
      )}
    </PopupShell>
  );
}
