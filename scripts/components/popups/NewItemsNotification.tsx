// New-items notification — Preact port of `views/notification.html`
// + the `notification_item.html` partial (issue #80 phase 2 tier 2).
// Used by the `data.perps` and `data.powerups` branches of
// `GameRoot.makeNotifications` (level-up unlocks, project upgrade
// unlocks).  Dismissed via the OK MainButton — the jQuery delegated
// handler in `RenderTopLevelUI.ts` fires `button_click.MainButton`,
// which the popup-events init in `GameNode.initPopupEvents` translates
// into `popup_close`.

import { render } from 'preact';
import i18n from '../../i18n.js';
import { type SpriteHelperConfig, renderSpriteHtml } from '../../render/renderSpriteHelper.js';

export interface NewItemsPerp {
  data?: {
    popup_sprite?: SpriteHelperConfig;
    title?: string;
    subtitle?: string;
    description?: string;
  };
}

export interface NewItemsNotificationProps {
  title?: string | undefined;
  /** Speaker label; defaults to localized "Mark says:". */
  says?: string | undefined;
  /**
   * Body HTML.  Legacy `<%= text %>` rendered raw HTML; ruleset
   * ntext strings may include spans for the parent / project name.
   */
  textHtml?: string | undefined;
  /** Optional perp to render in the `notification_item.html` slot. */
  perp?: NewItemsPerp | undefined;
}

function NotificationItem({ perp }: { perp: NewItemsPerp }) {
  const data = perp.data ?? {};
  const spriteHtml = renderSpriteHtml(data.popup_sprite);
  return (
    <div class="NotificationItem">
      <div class="Subpop open">
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: locally produced sprite markup */}
        <div class="SubpopLogo" dangerouslySetInnerHTML={{ __html: spriteHtml }} />
        <div class="SubpopTitle">{data.title}</div>
        <div class="SubpopSubTitle">{data.subtitle}</div>
        <div class="SubpopText">{data.description}</div>
      </div>
    </div>
  );
}

export function NewItemsNotification({ title, says, textHtml, perp }: NewItemsNotificationProps) {
  const speaker = says ?? i18n.gettext('Mark says:');
  return (
    <div class="PopupBody NotificationBody">
      <div class="NotificationHeader">
        <div class="PopupClose">X</div>
        <div class="NotificationTitle">{title}</div>
      </div>
      <div class="NotificationContent">
        {perp ? <NotificationItem perp={perp} /> : null}
        <div class="NotificationBubble">
          <div class="NotificationAvatar" />
          <div class="NotificationSays">{speaker}</div>
          {/* biome-ignore lint/security/noDangerouslySetInnerHtml: trusted ruleset / i18n string */}
          <div class="NotificationText" dangerouslySetInnerHTML={{ __html: textHtml ?? '' }} />
          <div class="PopupButtons NotificationButtons">
            <div class="Button" data-button-id="MainButton">
              {i18n.gettext('OK')}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function mountNewItemsNotification(
  container: HTMLElement,
  props: NewItemsNotificationProps
): void {
  render(<NewItemsNotification {...props} />, container);
}
