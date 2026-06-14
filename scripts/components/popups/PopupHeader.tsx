// Shared `.PopupHeader` chrome — the close button + logo + title +
// optional subtitle/description block that Contact / Client /
// ProfileSet / City / Token / ProvidedPerp reproduced verbatim, each
// with its own identical `closeX` handler.  One component so the
// header markup + close behaviour lives in a single place (notably:
// one spot to restyle for the mobile port).  ProjectPopup keeps its
// own header — its per-tab `.PopupText.TabText` descriptions render
// between title and menu, which this layout doesn't model.
//
// Every field is opt-in so each caller's exact DOM is preserved: an
// omitted prop renders no element.  `children` render after the
// description for headers that carry extra content (City's
// `.PopupMenu` tab strip, Token's `.PopupButtons`).

import type { ComponentChildren } from 'preact';
import { stopAndClose } from './dialogManager.js';

export interface PopupHeaderProps {
  /** Framework `onClose`; the X stops propagation so the backdrop
   *  handler doesn't double-fire (mirrors the old per-file `closeX`). */
  onClose: () => void;
  /** `MainSpritesPopup` logo class.  Takes precedence over `spriteHtml`.
   *  `| undefined` so callers can forward an optional VM field directly
   *  under `exactOptionalPropertyTypes`. */
  mainspritesClass?: string | undefined;
  /** Pre-rendered sprite markup for the logo (legacy `<%= sprite %>`). */
  spriteHtml?: string;
  title?: string;
  /** Raw-HTML title (legacy `<%= %>`); wins over `title`. */
  titleHtml?: string;
  /** Plain-text subtitle. */
  subtitle?: string;
  /** Raw-HTML subtitle (legacy `<% print %>`); wins over `subtitle`. */
  subtitleHtml?: string;
  /** Plain-text description (`.PopupText`). */
  description?: string;
  /** Extra in-header content rendered after the description. */
  children?: ComponentChildren;
}

export function PopupHeader({
  onClose,
  mainspritesClass,
  spriteHtml,
  title,
  titleHtml,
  subtitle,
  subtitleHtml,
  description,
  children,
}: PopupHeaderProps) {
  const close = stopAndClose(onClose);
  return (
    <div class="PopupHeader">
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: legacy DOM structure, keyboard support is a separate a11y pass */}
      <div class="PopupClose" onClick={close}>
        X
      </div>
      {mainspritesClass ? (
        <div class="PopupLogo">
          <div class={`MainSpritesPopup ${mainspritesClass}`} />
        </div>
      ) : (
        // biome-ignore lint/security/noDangerouslySetInnerHtml: locally produced sprite markup
        <div class="PopupLogo" dangerouslySetInnerHTML={{ __html: spriteHtml ?? '' }} />
      )}
      {titleHtml !== undefined ? (
        // biome-ignore lint/security/noDangerouslySetInnerHtml: raw ruleset HTML (legacy <%= %>)
        <div class="PopupTitle" dangerouslySetInnerHTML={{ __html: titleHtml }} />
      ) : (
        <div class="PopupTitle">{title ?? ''}</div>
      )}
      {subtitleHtml !== undefined ? (
        // biome-ignore lint/security/noDangerouslySetInnerHtml: raw ruleset HTML (legacy <% print %>)
        <div class="PopupSubTitle" dangerouslySetInnerHTML={{ __html: subtitleHtml }} />
      ) : subtitle !== undefined ? (
        <div class="PopupSubTitle">{subtitle}</div>
      ) : null}
      {description !== undefined ? <div class="PopupText">{description}</div> : null}
      {children}
    </div>
  );
}
