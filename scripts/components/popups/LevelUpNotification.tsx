// Level-up celebration notification.  No buttons; dismissed by
// tapping anywhere (the body's own `onClick={onClose}`).

import { sprintf, toKSNum } from '../../dd-helpers.js';
import i18n from '../../i18n.js';

export interface LevelUpNotificationProps {
  /** Current level. */
  xpLevel: number;
  /** XP remaining until next level. */
  xpToNext: number;
  /** AP cap that the new level unlocked. */
  apMax: number;
  /** Framework-injected by the dialog manager. */
  onClose: () => void;
}

export function LevelUpNotification({
  xpLevel,
  xpToNext,
  apMax,
  onClose,
}: LevelUpNotificationProps) {
  const says = i18n.gettext('Mark says:');
  // Legacy template rendered this as `<%= text %>` (raw HTML); the
  // levelup i18n catalog string embeds spans (Level / XP / energy).
  const textHtml = sprintf(
    i18n.gettext('levelup level %s! %s XP to level %s. %s energy'),
    toKSNum(xpLevel),
    toKSNum(xpToNext),
    toKSNum(xpLevel + 1),
    toKSNum(apMax)
  );
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: tutorial-class popup is tap-to-advance UX; keyboard support is a separate a11y pass
    <div class="TutorialWrap" onClick={onClose}>
      <div class="PopupBody TutorialBody">
        <div class="TutorialContent">
          <div class="NotificationBubble">
            <div class="NotificationAvatar" />
            <div class="NotificationSays">{says}</div>
            {/* biome-ignore lint/security/noDangerouslySetInnerHtml: trusted ruleset / i18n string */}
            <div class="NotificationText" dangerouslySetInnerHTML={{ __html: textHtml }} />
          </div>
        </div>
      </div>
      <div class="TutorialTapHint">tap anywhere to continue</div>
    </div>
  );
}
