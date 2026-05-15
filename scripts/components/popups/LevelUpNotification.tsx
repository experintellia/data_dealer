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
  const text = sprintf(
    i18n.gettext('levelup level %s! %s XP to level %s. %s energy'),
    toKSNum(xpLevel),
    toKSNum(xpToNext),
    toKSNum(xpLevel + 1),
    toKSNum(apMax)
  );
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: tutorial-class popup is tap-to-advance UX; keyboard support is a separate a11y pass
    <div class="PopupBody TutorialBody" onClick={onClose}>
      <div class="TutorialContent">
        <div class="NotificationBubble">
          <div class="NotificationAvatar" />
          <div class="NotificationSays">{says}</div>
          <div class="NotificationText">{text}</div>
          <div class="TutorialTapHint">tap anywhere to continue</div>
        </div>
      </div>
    </div>
  );
}
