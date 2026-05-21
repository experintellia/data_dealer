// About dialog — Preact port of `views/popup_user_data.html`
// (issue #80).  Purely informational: a blurb about this webxdc
// fork and the original game, plus a Close button.  The legacy
// template carried a dev-only "Debug" reset tab, but webxdc has no
// resetGame (reset = re-share the .xdc), so there is no second tab —
// the dialog is single-purpose and stateless.

import type { JSX } from 'preact';
import i18n from '../../i18n.js';
import { Link } from '../Link.js';

export interface AboutPopupProps {
  /** `game.setup.locale` — MainMenuLogo sprite locale class. */
  locale: string;
  buttonLabel: string;
  onClose: () => void;
}

// Translatable prose carries `%s` markers where external links sit;
// the link labels are URLs / repo names and stay literal, so we
// splice the <Link> nodes into the split string here.
function withLinks(template: string, links: JSX.Element[]): (string | JSX.Element)[] {
  const parts = template.split('%s');
  const out: (string | JSX.Element)[] = [];
  parts.forEach((part, i) => {
    if (part) out.push(part);
    const link = links[i];
    if (link) out.push(link);
  });
  return out;
}

export function AboutPopup({ locale, buttonLabel, onClose }: AboutPopupProps) {
  const close = (e: JSX.TargetedMouseEvent<HTMLDivElement>): void => {
    e.stopPropagation();
    onClose();
  };
  return (
    <div class="PopupBody About">
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: legacy DOM structure, keyboard support is a separate a11y pass */}
      <div class="PopupClose" onClick={close}>
        X
      </div>
      <div class="PopupContent">
        <div class="PopupTab">
          <div class="SubpopContainer" />
          <div class={`RenderSprite MainMenuLogo ${locale}`} />
          <div class="PopupContentText">
            <div class="PopupTitle">{i18n.gettext('about fork headline')}</div>
            <div class="PopupParagraph">
              {withLinks(i18n.gettext('about fork text'), [
                <Link key="repo" href="https://github.com/experintellia/data_dealer">
                  github.com/experintellia/data_dealer
                </Link>,
              ])}
            </div>
            <div class="PopupParagraph">{i18n.gettext('about displayname text')}</div>
          </div>
          <div class="PopupContentText">
            <div class="PopupTitle">{i18n.gettext('about original headline')}</div>
            <div class="PopupParagraph">
              {withLinks(i18n.gettext('about original text'), [
                <Link key="dd_js" href="https://github.com/datadealer/dd_js">
                  dd_js
                </Link>,
                <Link key="dd_rules" href="https://github.com/datadealer/dd_rules">
                  dd_rules
                </Link>,
                <Link key="dd_app" href="https://github.com/datadealer/dd_app">
                  dd_app
                </Link>,
              ])}
            </div>
            <div class="PopupParagraph">
              {withLinks(i18n.gettext('about original faq'), [
                <Link key="beta" href="https://datadealer.com/beta">
                  datadealer.com/beta
                </Link>,
              ])}
            </div>
          </div>
        </div>
      </div>
      {/* Sibling of the scrolling `.PopupContent` so it stays docked at
          the dialog's bottom while the prose scrolls behind it. */}
      <div class="PopupButtons">
        {/* biome-ignore lint/a11y/useKeyWithClickEvents: legacy DOM structure, keyboard support is a separate a11y pass */}
        <div class="Button" data-button-id="MainButton" onClick={close}>
          {buttonLabel}
        </div>
      </div>
    </div>
  );
}
