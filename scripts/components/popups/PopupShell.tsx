// Shared chrome for popups that follow the
// `PopupBody > PopupHeader { close, logo, title, [body], buttons }`
// shape — used by the four status-bar info popups so far, scalable to
// the other simple-info dialogs in tier 2+ (issue #80 phase 2).
//
// All close-paths fire `onClose` (received via the dialog manager's
// framework-injected prop) and call `stopPropagation` so the
// dialog-manager backdrop click handler doesn't double-fire.

import type { ComponentChildren } from 'preact';
import { stopAndClose } from './dialogManager.js';

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
  /** Framework-injected by the dialog manager. */
  onClose: () => void;
}

export function PopupShell({
  spriteClass,
  bodyClass,
  title,
  buttonLabel,
  children,
  onClose,
}: PopupShellProps) {
  const close = stopAndClose(onClose);
  return (
    <div class={bodyClass ? `PopupBody ${bodyClass}` : 'PopupBody'}>
      <div class="PopupHeader">
        {/* biome-ignore lint/a11y/useKeyWithClickEvents: legacy DOM structure (div + .Button class), keyboard support is a separate phase 3 a11y pass */}
        <div class="PopupClose" onClick={close}>
          X
        </div>
        <div class="PopupLogo">
          <div class={`MainSpritesPopup ${spriteClass}`} />
        </div>
        <div class="PopupTitle">{title}</div>
        {children}
        <div class="PopupButtons">
          {/* biome-ignore lint/a11y/useKeyWithClickEvents: legacy DOM structure (div + .Button class), keyboard support is a separate phase 3 a11y pass */}
          <div class="Button" data-button-id="MainButton" onClick={close}>
            {buttonLabel}
          </div>
        </div>
      </div>
    </div>
  );
}
