import { span, sprintf, toKSNum } from '../../dd-helpers.js';
import i18n from '../../i18n.js';
import { PopupShell } from './PopupShell.js';

export interface ProfilesStatusPopupProps {
  profilesValue: number;
  profilesMax: number;
  onClose: () => void;
}

export function ProfilesStatusPopup({
  profilesValue,
  profilesMax,
  onClose,
}: ProfilesStatusPopupProps) {
  const subtitleHtml = sprintf(
    i18n.gettext('sb_profiles subtitle %s from %s profiles'),
    span(toKSNum(profilesValue)),
    span(toKSNum(profilesMax))
  );
  return (
    <PopupShell
      spriteClass="Profiles"
      bodyClass="Status"
      title={i18n.gettext('sb_profiles title')}
      buttonLabel={i18n.gettext('Close')}
      onClose={onClose}
    >
      {/* biome-ignore lint/security/noDangerouslySetInnerHtml: trusted i18n catalog string */}
      <div class="PopupSubTitle" dangerouslySetInnerHTML={{ __html: subtitleHtml }} />
      <div class="PopupText">{i18n.gettext('sb_profiles description')}</div>
    </PopupShell>
  );
}
