// Tutorial / story / simplemessage notifications.  No buttons;
// dismissed by tapping anywhere (the body's own `onClick={onClose}`).

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
  // Tap anywhere on the wrapper (white card OR the tap hint sitting
  // below it) advances the tutorial.  Hint is a sibling of the body
  // — not a child — so it can flow below the card without needing
  // absolute positioning (which clipped on a phone viewport).
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: tutorial-class popup is tap-to-advance UX; keyboard support is a separate a11y pass
    <div class="TutorialWrap" onClick={onClose}>
      <div class="PopupBody TutorialBody">
        <div class="NotificationAvatar" />
        <div class="NotificationContent">
          <div class="NotificationSays">{speaker}</div>
          {/* biome-ignore lint/security/noDangerouslySetInnerHtml: trusted ruleset / i18n string */}
          <div class="NotificationText" dangerouslySetInnerHTML={{ __html: descriptionHtml }} />
        </div>
      </div>
      <div class="TutorialTapHint">tap anywhere to continue</div>
    </div>
  );
}
