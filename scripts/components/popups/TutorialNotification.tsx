// Tutorial / story / simplemessage notifications — Preact port of
// `views/notification_tutorial.html` (issue #80 phase 2 tier 2).  No
// buttons; tutorial-class popup is dismissed by tapping anywhere
// (jQuery handler in RenderTopLevelUI.ts).

import i18n from '../../i18n.js';

export interface TutorialNotificationProps {
  /** Speaker label.  Defaults to the localized "Mark says:" string. */
  says?: string;
  /**
   * Body HTML.  Legacy template rendered this as `<%= text %>` (raw
   * HTML); ruleset tutorial entries can embed spans / highlights.
   */
  descriptionHtml: string;
  /** Framework-injected by the dialog manager. */
  onClose: () => void;
}

export function TutorialNotification({
  says,
  descriptionHtml,
  onClose,
}: TutorialNotificationProps) {
  const speaker = says ?? i18n.gettext('Mark says:');
  // Tap anywhere on the body advances the tutorial — matches the
  // legacy `extendClass === 'Tutorial'` jQuery handler in
  // `RenderTopLevelUI.initBaseUI`.
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: tutorial-class popup is tap-to-advance UX; keyboard support is a separate a11y pass
    <div class="PopupBody TutorialBody" onClick={onClose}>
      <div class="TutorialContent">
        <div class="NotificationBubble">
          <div class="NotificationAvatar" />
          <div class="NotificationSays">{speaker}</div>
          {/* biome-ignore lint/security/noDangerouslySetInnerHtml: trusted ruleset / i18n string */}
          <div class="NotificationText" dangerouslySetInnerHTML={{ __html: descriptionHtml }} />
          <div class="TutorialTapHint">tap anywhere to continue</div>
        </div>
      </div>
    </div>
  );
}
