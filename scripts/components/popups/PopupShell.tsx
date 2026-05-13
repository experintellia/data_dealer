// Shared chrome for popups that follow the
// `PopupBody > PopupHeader { close, logo, title, [body], buttons }`
// shape — used by the four status-bar info popups so far, scalable to
// the other simple-info dialogs in tier 2+ (issue #80 phase 2).  Click
// handling stays on the `RenderPopup` jQuery delegated handlers in
// RenderTopLevelUI.ts; this component only owns the DOM _content_.

import type { ComponentChildren } from 'preact';

export interface PopupShellProps {
  /**
   * Sprite key the legacy template wrote as
   * `<div class="MainSpritesPopup <%= sprite %>">`.
   */
  spriteClass: string;
  /**
   * Extra body classes ('Status', etc.).  Concatenated onto the
   * `PopupBody` root.  Omit for the default body.
   */
  bodyClass?: string;
  title: string;
  buttonLabel: string;
  /** Subtitle + description, etc. — rendered between title and buttons. */
  children?: ComponentChildren;
}

export function PopupShell({
  spriteClass,
  bodyClass,
  title,
  buttonLabel,
  children,
}: PopupShellProps) {
  return (
    <div class={bodyClass ? `PopupBody ${bodyClass}` : 'PopupBody'}>
      <div class="PopupHeader">
        <div class="PopupClose">X</div>
        <div class="PopupLogo">
          <div class={`MainSpritesPopup ${spriteClass}`} />
        </div>
        <div class="PopupTitle">{title}</div>
        {children}
        <div class="PopupButtons">
          <div class="Button" data-button-id="MainButton">
            {buttonLabel}
          </div>
        </div>
      </div>
    </div>
  );
}
