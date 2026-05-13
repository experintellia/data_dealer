// Tutorial / story / simplemessage notifications — Preact port of
// `views/notification_tutorial.html` (issue #80 phase 2 tier 2).  No
// buttons; tutorial-class popup is dismissed by tapping anywhere
// (jQuery handler in RenderTopLevelUI.ts).

import { render } from 'preact';
import i18n from '../../i18n.js';

export interface TutorialNotificationProps {
  /** Speaker label.  Defaults to the localized "Mark says:" string. */
  says?: string;
  /**
   * Body HTML.  Legacy template rendered this as `<%= text %>` (raw
   * HTML); ruleset tutorial entries can embed spans / highlights.
   */
  descriptionHtml: string;
}

export function TutorialNotification({ says, descriptionHtml }: TutorialNotificationProps) {
  const speaker = says ?? i18n.gettext('Mark says:');
  return (
    <div class="PopupBody TutorialBody">
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

export function mountTutorialNotification(
  container: HTMLElement,
  props: TutorialNotificationProps
): void {
  render(<TutorialNotification {...props} />, container);
}
