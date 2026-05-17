// About dialog — Preact port of `views/popup_user_data.html`
// (issue #80 phase 2 tier 4).  Informational; the only interactive
// surface is the dev-only Debug tab (gated on `userdebug`).  First
// multi-tab dialog: the active tab
// is a `useState` value and the DOM is derived from it, so the
// "tab description sometimes not shown" desync the legacy
// jQuery-`.show()/.hide()` flow could produce is structurally
// impossible here.
//
// The `.PopupMenu` tab strip + the Debug tab only render when
// `userdebug` is on (matches the legacy `game.setup.userdebug`
// gate).  About copy is intentionally literal (not i18n) — it was
// hardcoded in the template too.

import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import i18n from '../../i18n.js';

export interface AboutPopupProps {
  /** `game.setup.userdebug` — gates the tab strip + Debug tab. */
  userdebug: boolean;
  /** `game.setup.locale` — MainMenuLogo sprite locale class. */
  locale: string;
  buttonLabel: string;
  onClose: () => void;
}

type Tab = 'settings' | 'debug';

export function AboutPopup({ userdebug, locale, buttonLabel, onClose }: AboutPopupProps) {
  const [tab, setTab] = useState<Tab>('settings');
  const close = (e: JSX.TargetedMouseEvent<HTMLDivElement>): void => {
    e.stopPropagation();
    onClose();
  };
  // Mirror the legacy jQuery `.show()/.hide()` (inline display) so the
  // phase-1 contract's toBeVisible / toBeHidden assertions hold while
  // keeping both panels in the DOM.
  const tabStyle = (t: Tab): { display: string } => ({
    display: tab === t ? '' : 'none',
  });
  return (
    <div class="PopupBody About">
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: legacy DOM structure, keyboard support is a separate a11y pass */}
      <div class="PopupClose" onClick={close}>
        X
      </div>
      {userdebug ? (
        <div class="PopupMenu">
          {/* biome-ignore lint/a11y/useKeyWithClickEvents: legacy DOM structure, keyboard support is a separate a11y pass */}
          <div
            class={tab === 'settings' ? 'PopupMenuButton active' : 'PopupMenuButton'}
            data-tab="settings"
            onClick={() => setTab('settings')}
          >
            About
          </div>
          {/* biome-ignore lint/a11y/useKeyWithClickEvents: legacy DOM structure, keyboard support is a separate a11y pass */}
          <div
            class={tab === 'debug' ? 'PopupMenuButton active' : 'PopupMenuButton'}
            data-tab="debug"
            onClick={() => setTab('debug')}
          >
            {i18n.gettext('userdebug tab')}
          </div>
        </div>
      ) : null}
      <div class="PopupContent">
        <div class="PopupTab" data-tab="settings" style={tabStyle('settings')}>
          <div class="SubpopContainer" />
          <div class={`RenderSprite MainMenuLogo ${locale}`} />
          <div class="PopupContentText">
            <div class="PopupTitle">About this fork</div>
            <div class="PopupParagraph">
              This is a webxdc port of the original Data Dealer browser game, repackaged so it can
              run inside a Delta Chat group with no server. Source, issues and contributions:{' '}
              <a
                href="https://github.com/experintellia/data_dealer"
                class="mln"
                target="_blank"
                rel="noreferrer noopener"
              >
                github.com/experintellia/data_dealer
              </a>
              .
            </div>
            <div class="PopupParagraph">
              Your display name is set through your Delta Chat profile &mdash; change it there and
              the game picks it up automatically.
            </div>
          </div>
          <div class="PopupContentText">
            <div class="PopupTitle">The original game</div>
            <div class="PopupParagraph">
              Data Dealer was created in Vienna by Cuteacute Media OG between 2011 and 2014 (Ivan
              Averintsev, Wolfie Christl, Pascale Osterwalder, Tobi Sch&auml;fer, Ralf
              Traunsteiner). It was a satirical browser game about the personal-data trade, released
              as a public beta on datadealer.com and open-sourced as{' '}
              <a
                href="https://github.com/datadealer/dd_js"
                class="mln"
                target="_blank"
                rel="noreferrer noopener"
              >
                dd_js
              </a>
              ,{' '}
              <a
                href="https://github.com/datadealer/dd_rules"
                class="mln"
                target="_blank"
                rel="noreferrer noopener"
              >
                dd_rules
              </a>{' '}
              and{' '}
              <a
                href="https://github.com/datadealer/dd_app"
                class="mln"
                target="_blank"
                rel="noreferrer noopener"
              >
                dd_app
              </a>
              .
            </div>
            <div class="PopupParagraph">
              Background info and the original FAQ:{' '}
              <a
                href="https://datadealer.com/beta"
                class="mln"
                target="_blank"
                rel="noreferrer noopener"
              >
                datadealer.com/beta
              </a>
              .
            </div>
          </div>
          <div class="PopupButtons">
            {/* biome-ignore lint/a11y/useKeyWithClickEvents: legacy DOM structure, keyboard support is a separate a11y pass */}
            <div class="Button" data-button-id="MainButton" onClick={close}>
              {buttonLabel}
            </div>
          </div>
        </div>
        {userdebug ? (
          <div class="PopupTab" data-tab="debug" style={tabStyle('debug')}>
            <div class="SubpopContainer" />
            <div class="PopupContentText">
              <div class="PopupTitle">{i18n.gettext('userdebug reset game headline')}</div>
              <div class="PopupParagraph">{i18n.gettext('userdebug reset game text')}</div>
            </div>
            <div class="PopupButtons">
              {/* Dead button (phase-1 spec Section N): webxdc has no
                  resetGame — reset = re-share the .xdc.  DOM kept for
                  the contract / future wiring. */}
              <div
                class="Button sell"
                data-button-id="ResetButton"
                data-testid="dd-reset-game-button"
              >
                {i18n.gettext('Reset Game')}
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
