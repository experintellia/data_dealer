// Level-up celebration notification — Preact port of `views/levelup.html`
// (issue #80 phase 2 tier 2).  No buttons; the tutorial-class popup is
// dismissed by tapping anywhere (jQuery handler in RenderTopLevelUI.ts
// `if (node.extendClass === 'Tutorial')`).

import { render } from 'preact';
import { sprintf, toKSNum } from '../../dd-helpers.js';
import i18n from '../../i18n.js';

export interface LevelUpNotificationProps {
  /** Current level. */
  xpLevel: number;
  /** XP remaining until next level. */
  xpToNext: number;
  /** AP cap that the new level unlocked. */
  apMax: number;
}

export function LevelUpNotification({ xpLevel, xpToNext, apMax }: LevelUpNotificationProps) {
  const says = i18n.gettext('Mark says:');
  const text = sprintf(
    i18n.gettext('levelup level %s! %s XP to level %s. %s energy'),
    toKSNum(xpLevel),
    toKSNum(xpToNext),
    toKSNum(xpLevel + 1),
    toKSNum(apMax)
  );
  return (
    <div class="PopupBody TutorialBody">
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

export function mountLevelUpNotification(
  container: HTMLElement,
  props: LevelUpNotificationProps
): void {
  render(<LevelUpNotification {...props} />, container);
}
