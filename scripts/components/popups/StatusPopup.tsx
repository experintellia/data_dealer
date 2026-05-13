// Shared Preact component for the four status-bar info popups
// (Profiles / Cash / AP / XP).  Replaces `views/popup_status.html`,
// deleted alongside this component's tier-1 PR.  All click handling
// stays on the `RenderPopup` jQuery delegated handlers in
// RenderTopLevelUI.ts; this component only owns the DOM _content_.

import { render } from 'preact';

export type StatusSpriteClass = 'Profiles' | 'Cash' | 'AP' | 'XP';

export interface StatusPopupProps {
  /** Sprite key the legacy template wrote as `<div class="MainSpritesPopup <%= sprite %>">`. */
  spriteClass: StatusSpriteClass;
  /** Pre-i18n title, e.g. "Cash" / "Energy" / "Level". */
  title: string;
  /**
   * Pre-formatted subtitle HTML (gettext + sprintf already applied).
   * The legacy template wrote `<%= subtitle %>` (raw HTML), and some
   * catalog entries wrap values in `<span class="highlight">` while
   * others (de_AT for Cash) drop the span entirely.  Render via
   * `dangerouslySetInnerHTML` to keep behavior identical across
   * locales without breaking the existing translations.
   */
  subtitleHtml: string;
  /** Pre-formatted description HTML — XP wraps the countdown in a span. */
  descriptionHtml: string;
  buttonLabel: string;
}

export function StatusPopup({
  spriteClass,
  title,
  subtitleHtml,
  descriptionHtml,
  buttonLabel,
}: StatusPopupProps) {
  return (
    <div class="PopupBody Status">
      <div class="PopupHeader">
        <div class="PopupClose">X</div>
        <div class="PopupLogo">
          <div class={`MainSpritesPopup ${spriteClass}`} />
        </div>
        <div class="PopupTitle">{title}</div>
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: trusted i18n catalog string */}
        <div class="PopupSubTitle" dangerouslySetInnerHTML={{ __html: subtitleHtml }} />
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: trusted i18n catalog string */}
        <div class="PopupText" dangerouslySetInnerHTML={{ __html: descriptionHtml }} />
        <div class="PopupButtons">
          <div class="Button" data-button-id="MainButton">
            {buttonLabel}
          </div>
        </div>
      </div>
    </div>
  );
}

export function mountStatusPopup(container: HTMLElement, props: StatusPopupProps): void {
  render(<StatusPopup {...props} />, container);
}
