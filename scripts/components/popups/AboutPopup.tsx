// About dialog — Preact port of `views/popup_user_data.html`
// (issue #80).  Purely informational: a blurb about this webxdc
// fork and the original game, plus a Close button.  The legacy
// template carried a dev-only "Debug" reset tab, but webxdc has no
// resetGame (reset = re-share the .xdc), so there is no second tab —
// the dialog is single-purpose and stateless.

import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import i18n from '../../i18n.js';
import { Link } from '../Link.js';
import { attachDragScroll } from './scrollDrag.js';

/** Why an import attempt failed; maps to a localized message in the popup. */
export type ImportErrorKind = 'malformed' | 'version' | 'unavailable';

/** Normalized outcome of an import attempt, as handed back by `onImport`.
 *  Keeps the component decoupled from LocalEngine's result shape. */
export type ImportOutcome =
  | { status: 'ok' }
  | { status: 'cancelled' }
  | { status: 'error'; errorKind: ImportErrorKind };

export interface AboutPopupProps {
  /** `game.setup.locale` — MainMenuLogo sprite locale class. */
  locale: string;
  buttonLabel: string;
  onClose: () => void;
  /** Export the current player's save via webxdc sendToChat. Fire-and-forget:
   *  sendToChat may close the app before it resolves. Omitted in environments
   *  without a messenger (the section is then hidden). */
  onExport?: () => void;
  /** Pick + load a save file; resolves with the outcome so the popup can show
   *  an error or trigger a reload. Omitted → section hidden. */
  onImport?: () => Promise<ImportOutcome>;
}

const IMPORT_ERROR_KEY: Record<ImportErrorKind, string> = {
  malformed: 'save import error malformed',
  version: 'save import error version',
  unavailable: 'save import error unavailable',
};

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

export function AboutPopup({ locale, buttonLabel, onClose, onExport, onImport }: AboutPopupProps) {
  const close = (e: JSX.TargetedMouseEvent<HTMLDivElement>): void => {
    e.stopPropagation();
    onClose();
  };

  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    return attachDragScroll(el, 'y');
  }, []);

  const handleImport = (): void => {
    if (!onImport || importing) return;
    setImporting(true);
    setImportError(null);
    onImport()
      .then((outcome) => {
        if (outcome.status === 'ok') {
          // Replay rebuilds state from the imported delta (mirrors setLocale).
          window.location.reload();
          return;
        }
        if (outcome.status === 'error') {
          setImportError(i18n.gettext(IMPORT_ERROR_KEY[outcome.errorKind]));
        }
        setImporting(false);
      })
      .catch(() => {
        setImportError(i18n.gettext(IMPORT_ERROR_KEY.malformed));
        setImporting(false);
      });
  };
  return (
    <div class="PopupBody About">
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: legacy DOM structure, keyboard support is a separate a11y pass */}
      <div class="PopupClose" onClick={close}>
        X
      </div>
      {/* tabIndex={0} lets keyboard users Tab-focus and arrow-key scroll the content */}
      <div class="PopupContent" ref={contentRef} tabIndex={0}>
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
          {(onExport || onImport) && (
            <div class="PopupContentText SaveSection">
              <div class="PopupTitle">{i18n.gettext('save section headline')}</div>
              <div class="PopupParagraph">{i18n.gettext('save section text')}</div>
              <div class="SaveButtons">
                {onExport && (
                  // biome-ignore lint/a11y/useKeyWithClickEvents: legacy DOM structure, keyboard support is a separate a11y pass
                  <div class="Button" data-button-id="ExportSave" onClick={() => onExport()}>
                    {i18n.gettext('Export Save')}
                  </div>
                )}
                {onImport && (
                  // biome-ignore lint/a11y/useKeyWithClickEvents: legacy DOM structure, keyboard support is a separate a11y pass
                  <div
                    class={importing ? 'Button disabled' : 'Button'}
                    data-button-id="ImportSave"
                    onClick={handleImport}
                  >
                    {i18n.gettext('Import Save')}
                  </div>
                )}
              </div>
              {importError && <div class="PopupParagraph SaveError">{importError}</div>}
            </div>
          )}
          <div class="PopupButtons">
            {/* biome-ignore lint/a11y/useKeyWithClickEvents: legacy DOM structure, keyboard support is a separate a11y pass */}
            <div class="Button" data-button-id="MainButton" onClick={close}>
              {buttonLabel}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
