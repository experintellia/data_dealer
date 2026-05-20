// Drives the `data.perps` and `data.powerups` notification branches
// in `GameRoot.makeNotifications` (level-up unlocks, project upgrade
// unlocks).

import type { JSX } from 'preact';
import i18n from '../../i18n.js';
import { type SpriteHelperConfig, renderSpriteHtml } from '../../render/renderSpriteHelper.js';
import { MarcoSpeech } from '../MarcoSpeech.js';

export interface NewItemsPerp {
  data?: {
    popup_sprite?: SpriteHelperConfig | undefined;
    title?: string | undefined;
    subtitle?: string | undefined;
    description?: string | undefined;
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
  /** Framework-injected by the dialog manager. */
  onClose: () => void;
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

export function NewItemsNotification({
  title,
  says,
  textHtml,
  perp,
  onClose,
}: NewItemsNotificationProps) {
  const speaker = says ?? i18n.gettext('Mark says:');
  const close = (e: JSX.TargetedMouseEvent<HTMLDivElement>): void => {
    e.stopPropagation();
    onClose();
  };
  return (
    <div class="PopupBody NotificationBody">
      <div class="NotificationHeader">
        {/* biome-ignore lint/a11y/useKeyWithClickEvents: legacy DOM structure, keyboard support is a separate a11y pass */}
        <div class="PopupClose" onClick={close}>
          X
        </div>
        <div class="NotificationTitle">{title}</div>
      </div>
      <div class="NotificationContent">
        {perp ? <NotificationItem perp={perp} /> : null}
        <MarcoSpeech says={speaker} bodyHtml={textHtml ?? ''} />
        <div class="PopupButtons NotificationButtons">
          {/* biome-ignore lint/a11y/useKeyWithClickEvents: legacy DOM structure, keyboard support is a separate a11y pass */}
          <div class="Button" data-button-id="MainButton" onClick={close}>
            {i18n.gettext('OK')}
          </div>
        </div>
      </div>
    </div>
  );
}
