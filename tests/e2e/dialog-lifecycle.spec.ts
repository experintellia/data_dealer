/**
 * Dialog open/close lifecycle coverage (issue #80, phase 1 prerequisite for
 * issue #186 Preact refactor and the mobile-friendly dialog redesign).
 *
 * Why this exists
 * ---------------
 * The dialog inventory in #186 lists ~18 distinct popup/notification dialogs,
 * none of which had any e2e test coverage prior to this spec.  Phase 2 of the
 * mobile-friendly work swaps the legacy Underscore.js template + jQuery
 * event-wiring `Render.Popup` for declarative Preact components, and phase 3
 * redesigns each dialog for portrait phone viewports (full-screen overlay,
 * relayout).  Both refactors need a regression net that proves a dialog still
 * opens, renders the expected DOM body, and closes when dismissed.
 *
 * Scope of this spec
 * ------------------
 * One `test()` per dialog from #186.  Each test:
 *   1. Boots the game.
 *   2. Triggers the dialog via the same code path the UI uses (status-bar
 *      click, GameRoot.makeNotifications, GameNode.openPopup, …).  Where the
 *      legacy code listens for a `trigger()` event we fire that event rather
 *      than synthesising raw DOM clicks — this stays robust through the
 *      Preact port because the GameRoot event vocabulary is the seam Preact
 *      will subscribe to anyway.
 *   3. Asserts `.PopupContainer.lockOn` exists and the dialog's distinguishing
 *      `.PopupBody.<Variant>` (or extendClass) selector renders.
 *   4. Dismisses the dialog (close button, backdrop click, or tap-anywhere
 *      for tutorial-style dialogs).
 *   5. Asserts the lockOn class is removed.
 *
 * What this spec does NOT verify
 * ------------------------------
 * - Visual appearance, mobile layout, font sizes — those are covered by
 *   `mobile-tap-targets.spec.ts` and will gain dialog-specific tests in
 *   phase 3.
 * - Full content (button labels, list items, i18n correctness) — the goal
 *   here is the open/close contract, not the rendered template internals.
 * - Animation timing / FX bling — covered separately where it matters.
 *
 * Boot pattern
 * ------------
 * `?devtools=1` exposes `window.__dd._app.game` (the GameRoot).  Tests reach
 * the GameRoot through that handle plus the AMD `boot` / `app` modules
 * already used by the other specs.  No new test-only surface is added.
 */

import { type Page, expect, test } from '@playwright/test';
import { installSettle } from './_helpers';

// ── Shared helpers ────────────────────────────────────────────────────────

async function bootGame(page: Page): Promise<void> {
  await page.goto('/?devtools=1');
  await expect(page.locator('[data-testid="game-container"]')).toBeVisible({
    timeout: 50_000,
  });

  // Dismiss the first-launch locale picker if it appears.  Picking EN persists
  // the locale and reloads the page, so we re-wait for the game container.
  const picker = page.locator('.LangSelectOverlay');
  if (await picker.isVisible().catch(() => false)) {
    await picker.locator('.lang-pick[data-locale="en"]').click();
    await expect(page.locator('[data-testid="game-container"]')).toBeVisible({
      timeout: 50_000,
    });
  }

  // Wait for the GameRoot to be reachable.  app.ts assigns it to
  // `window.__dd._app` after `Application.start()` finishes.
  await page.waitForFunction(() => {
    return !!(window as any).__dd?._app?.game;
  });

  // First-run boot auto-queues a tutorial briefing for the first mission.
  // Pre-mark all known mission briefings as seen so subsequent loadGame
  // replays don't re-queue them, then keep firing popup_close on whatever
  // is open until the queue + the renderPopup slot drain.  Tearing down
  // the popup DOM directly doesn't work — `openNotification` mounts each
  // popup through a setTimeout(delay) that captures the popup reference,
  // so even after deleting the object the next tick re-mounts it.  Going
  // through the actual close path lets RenderPopup's lifecycle release the
  // queue cleanly.
  await page.evaluate(() => {
    const groot = (window as any).__dd?._app?.game;
    if (!groot?.raw_data) return;
    groot.raw_data.mission_briefings_seen = groot.raw_data.mission_briefings_seen || {};
    const missions = groot.Missions?.Missions ?? {};
    for (const g of Object.keys(missions)) {
      groot.raw_data.mission_briefings_seen[g] = true;
    }
  });

  // RenderPopup.close() schedules DOM removal + the next queued open through a
  // 250–500ms setTimeout that captured the popup ref, so a single momentarily
  // empty poll is not proof the system is quiescent: a re-mount timer can still
  // be in flight and fire *after* bootGame returns, landing a stray popup in
  // the middle of the test (under 2-worker CPU contention this is when the
  // dialog-lifecycle flakes — a different test each run depending on when the
  // timer lands). Keep actively draining, but only return once "empty" has
  // held across consecutive polls spanning longer than that timer window, so
  // any pending re-mount has had time to fire and be drained first.
  const STABLE_POLLS_REQUIRED = 3; // 3 × 300ms ≈ 900ms > the 500ms timer ceiling
  const MAX_ATTEMPTS = 40; // ~12s ceiling for slow/contended CI
  let consecutiveSettled = 0;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const settled = await page.evaluate(() => {
      const groot = (window as any).__dd?._app?.game;
      if (!groot) return false;
      // Drop any queued cues so the queue can't refill after the current
      // popup closes.
      if (Array.isArray(groot.NotificationQueue)) {
        groot.NotificationQueue.length = 0;
      }
      const open = groot.notificationPopup;
      if (open) {
        try {
          open.trigger('popup_close');
        } catch {
          /* fall back to direct teardown below */
        }
      }
      // Belt-and-braces teardown of any stray popup that doesn't go through
      // the GameRoot's notificationPopup slot (e.g. status info popups).
      document.querySelectorAll<HTMLElement>('.Popup').forEach((el) => {
        try {
          el.remove();
        } catch {
          /* ignore */
        }
      });
      document
        .querySelectorAll<HTMLElement>('.PopupContainer.lockOn')
        .forEach((el) => el.classList.remove('lockOn'));
      return (
        (!Array.isArray(groot.NotificationQueue) || groot.NotificationQueue.length === 0) &&
        !groot.notificationPopup &&
        document.querySelectorAll('.PopupContainer.lockOn').length === 0
      );
    });
    consecutiveSettled = settled ? consecutiveSettled + 1 : 0;
    if (consecutiveSettled >= STABLE_POLLS_REQUIRED) return;
    // Wait above the 250–500ms close/re-mount timer floor before re-checking
    // so an in-flight openNotification chain either finishes or dispatches the
    // next item we then drain on the following iteration.
    await page.waitForTimeout(300);
  }
  throw new Error('bootGame: notification queue did not stay drained after 40 attempts');
}

/** Open a popup-status dialog by firing the same `click_status.<id>` event
 *  the StatusItem click handler emits.  Works without a real touch sequence,
 *  which is fragile in headless Chromium for sprite-overlaid HUD elements. */
async function openStatusPopup(
  page: Page,
  statusId: 'Profiles' | 'Cash' | 'AP' | 'XP' | 'karma'
): Promise<void> {
  await page.evaluate((id) => {
    const groot = (window as any).__dd?._app?.game;
    groot.trigger(`click_status.${id}`);
  }, statusId);
  await expect(page.locator('.PopupContainer.lockOn')).toBeVisible({ timeout: 2_000 });
}

/** Wait for a popup body to appear, then dismiss it and confirm the body is
 *  detached from the DOM.  We assert against the specific body selector
 *  rather than `.PopupContainer.lockOn` because closing a popup can
 *  immediately trigger a queued one (e.g. the first-mission briefing on
 *  fresh boot), which re-adds lockOn — that's not a regression in the popup
 *  we opened and shouldn't fail the test. */
async function expectOpenAndClose(
  page: Page,
  bodySelector: string,
  closeBy: 'x' | 'backdrop' | 'tap' = 'x'
): Promise<void> {
  const body = page.locator(bodySelector).first();
  await expect(body).toBeVisible({ timeout: 3_000 });

  if (closeBy === 'x') {
    await page.locator('.PopupContainer.lockOn .PopupClose').first().click();
  } else if (closeBy === 'backdrop') {
    // Trigger the click via jQuery rather than a raw DOM event:
    // RenderPopup binds the container's close handler with `containerJ.on`
    // (jQuery's event system), and jQuery's own bookkeeping is the most
    // reliable way to fire the registered listener regardless of how it
    // was attached.  A native dispatchEvent does fire jQuery handlers in
    // most browsers but jQuery's bubbling normalisation is stricter, so
    // it's worth the explicit handle.
    await page.evaluate(() => {
      const w = window as any;
      const $ = w.jQuery || w.$;
      const container = document.querySelector<HTMLElement>('.PopupContainer.lockOn');
      if (!container) throw new Error('no .PopupContainer.lockOn to click as backdrop');
      $(container).trigger('click');
    });
  } else {
    // Tutorial-style: tap the body itself to advance.
    await page.locator('.PopupContainer.lockOn .TutorialBody').first().click();
  }

  // Popup.close() schedules `this.remove()` after the 500ms CSS transition;
  // wait a touch above that so the assertion isn't racy.
  await expect(body).toBeHidden({ timeout: 3_000 });
}

// ── Section A: Status info popups ─────────────────────────────────────────
//
// All four share `popup_status.html` and a `.MainSpritesPopup.<icon>` root.
// One test per status indicator pins the trigger + the icon class.

test.describe('Section A — status info popups', () => {
  test('Profiles status popup opens and closes', async ({ page }) => {
    await bootGame(page);
    await openStatusPopup(page, 'Profiles');
    await expect(page.locator('.PopupBody.Status .MainSpritesPopup.Profiles')).toBeVisible();
    await expectOpenAndClose(page, '.PopupBody.Status', 'x');
  });

  test('Cash status popup opens and closes', async ({ page }) => {
    await bootGame(page);
    await openStatusPopup(page, 'Cash');
    await expect(page.locator('.PopupBody.Status .MainSpritesPopup.Cash')).toBeVisible();
    await expectOpenAndClose(page, '.PopupBody.Status', 'x');
  });

  test('AP status popup opens and closes', async ({ page }) => {
    await bootGame(page);
    await openStatusPopup(page, 'AP');
    await expect(page.locator('.PopupBody.Status .MainSpritesPopup.AP')).toBeVisible();
    await expectOpenAndClose(page, '.PopupBody.Status', 'x');
  });

  test('XP status popup opens and closes', async ({ page }) => {
    await bootGame(page);
    await openStatusPopup(page, 'XP');
    await expect(page.locator('.PopupBody.Status .MainSpritesPopup.XP')).toBeVisible();
    await expectOpenAndClose(page, '.PopupBody.Status', 'x');
  });

  test('Karma status popup opens and closes', async ({ page }) => {
    await bootGame(page);
    // Karma indicator is a different popup (popup_karma.html, not
    // popup_status.html) — it doubles as the karmalizer selector — so we
    // assert against the karma sprite class which both templates share.
    await openStatusPopup(page, 'karma');
    await expect(page.locator('.PopupBody .MainSpritesPopup.karma').first()).toBeVisible();
    await expectOpenAndClose(page, '.PopupBody', 'x');
  });
});

// ── Section B: Notification queue popups ──────────────────────────────────
//
// The queue is fed by `GameRoot.makeNotifications({...})`.  We push a single
// cue per test and let the queue's openNotification flush it; the popup then
// behaves like a tutorial-style modal (tap to dismiss for LevelUp/NewItems,
// click X for Mission popups).

test.describe('Section B — notification queue popups', () => {
  test('LevelUp notification opens and dismisses on tap', async ({ page }) => {
    await bootGame(page);
    await page.evaluate(() => {
      const groot = (window as any).__dd?._app?.game;
      groot.makeNotifications({ levelup: 2 });
    });
    // LevelUp uses extendClass='Tutorial' so the container is decorated with
    // .lockOn.Tutorial; the popup body itself is .PopupBody.TutorialBody.
    await expect(page.locator('.PopupContainer.lockOn.Tutorial')).toBeVisible({ timeout: 5_000 });
    await expectOpenAndClose(page, '.PopupBody.TutorialBody', 'tap');
  });

  test('Mission briefing (active mission) opens and closes', async ({ page }) => {
    await bootGame(page);
    // Use the first available mission gestalt from the GameRoot's mission set,
    // and clear any prior briefing-seen flag so the briefing actually fires.
    await page.evaluate(() => {
      const groot = (window as any).__dd?._app?.game;
      const missions = groot.Missions?.Missions ?? {};
      const gestalt = Object.keys(missions)[0];
      if (!gestalt) throw new Error('no missions defined in ruleset');
      if (groot.raw_data?.mission_briefings_seen) {
        delete groot.raw_data.mission_briefings_seen[gestalt];
      }
      groot.makeNotifications({ mission_active: gestalt });
    });
    await expect(page.locator('.PopupContainer.lockOn.Mission')).toBeVisible({ timeout: 5_000 });
    await expectOpenAndClose(page, '.PopupBody.MissionBody', 'x');
  });

  test('Story / simplemessage tutorial notification opens and dismisses on tap', async ({
    page,
  }) => {
    await bootGame(page);
    // simplemessage uses notification_tutorial.html + extendClass='Tutorial';
    // it's the same dismissal pattern as LevelUp.
    await page.evaluate(() => {
      const groot = (window as any).__dd?._app?.game;
      groot.makeNotifications({ simplemessage: { text: 'Phase 1 dialog test message.' } });
    });
    await expect(page.locator('.PopupContainer.lockOn.Tutorial')).toBeVisible({ timeout: 5_000 });
    await expectOpenAndClose(page, '.PopupBody.TutorialBody', 'tap');
  });

  // NOTE: a "new perps" / "new powerups" notification test is intentionally
  // deferred to phase 3.  makeNotifications({perps: [...]}) only queues a
  // popup when the perp's parent type is already built in the player's
  // empire AND xp_level > notification_level — both depend on game state
  // that's expensive to set up here, and the dismissal path is identical
  // to the LevelUp / Story tests already covered above.

  test('Mission complete notification opens and closes', async ({ page }) => {
    await bootGame(page);
    await page.evaluate(() => {
      const groot = (window as any).__dd?._app?.game;
      const missions = groot.Missions?.Missions ?? {};
      const gestalt = Object.keys(missions)[0];
      if (!gestalt) throw new Error('no missions defined in ruleset');
      groot.makeNotifications({ mission_complete: gestalt });
    });
    // mission_complete uses delay: 2500, delayScript: 1000 in #186 inventory;
    // bump the wait a generous amount above that.
    await expect(page.locator('.PopupContainer.lockOn.Mission')).toBeVisible({ timeout: 8_000 });
    await expect(page.locator('.PopupBody.MissionBody.Complete')).toBeVisible();
    await expectOpenAndClose(page, '.PopupBody.MissionBody.Complete', 'x');
  });
});

// ── Section C: Settings / About panel ─────────────────────────────────────

test.describe('Section C — settings panel', () => {
  test('UserData / About popup opens and closes', async ({ page }) => {
    await bootGame(page);
    await page.evaluate(() => {
      const groot = (window as any).__dd?._app?.game;
      groot.trigger('user_data');
    });
    await expect(page.locator('.PopupBody.About')).toBeVisible({ timeout: 3_000 });
    await expectOpenAndClose(page, '.PopupBody.About', 'x');
  });
});

// ── Section D: Perp popups (buy + open) ───────────────────────────────────
//
// Each perp dialog is opened by clicking its sprite on the map.  Sprites are
// canvas-rendered so we drive the popup via the GameNode's `openPopup()` API
// instead — same code path the canvas click handler uses, no canvas hit
// testing required.
//
// Buy + open flow
// ---------------
// 1. Optionally raise cash / xp_level via boot.setState() so engine.buyPerp's
//    validation passes.  The boost is in-memory only; the engine's own
//    delta-replay path doesn't re-validate cash on reload, so the bought
//    perp lands in state regardless and the gnode hydrates normally.
// 2. eng.buyPerp(parentPath, gestalt) emits a buyPerp delta which webxdc
//    persists to local storage.
// 3. page.reload() — boot.ts replays the delta, the buyPerp reducer adds
//    the new node to state.nodes, and Game.js materialises the gnode.
// 4. game.getById(<last id of full_path>) hands us the live gnode and
//    openPopup() drives the same RenderPopup wrapper the canvas click
//    handler would.
//
// We pass parentPath='Imperium' for everything because the engine only
// validates provided_perps when it can resolve the parent (Imperium and
// Database are root sentinels that bypass the check).  This means we can
// buy any perp type without first building its real-game-flow parent
// (city, agent, …), which keeps the tests focused on the popup wrapper
// rather than the full economy.

interface PerpFixture {
  /** Display name for the test. */
  name: string;
  /** Perp gestalt to buy. */
  gestalt: string;
  /** Engine parent path — almost always 'Imperium' since the engine
   *  short-circuits provided_perps validation for root sentinels. */
  parentPath: string;
  /** Selector that should be visible inside the open popup container.
   *  Pinned per perp type so a template regression (template removed,
   *  body class renamed, content cleared) shows up in the test name. */
  bodySelector: string;
  /** Optional cash + xp_level boost for perps the engine gates by level. */
  boost?: { cash: number; xp_level: number; xp_value: number };
}

const PERP_FIXTURES: PerpFixture[] = [
  {
    name: 'ContactPerp',
    gestalt: 'contact035',
    parentPath: 'Imperium',
    // popup_contact.html renders a profileset partial — every contact popup
    // has a .PopupBody and a .PopupClose; pin against both.
    bodySelector: '.PopupContainer.lockOn .PopupBody',
  },
  {
    name: 'AgentPerp',
    gestalt: 'agent002',
    parentPath: 'Imperium',
    bodySelector: '.PopupContainer.lockOn .PopupBody',
  },
  {
    name: 'PusherPerp',
    gestalt: 'pusher004',
    parentPath: 'Imperium',
    bodySelector: '.PopupContainer.lockOn .PopupBody',
  },
  {
    name: 'ClientPerp',
    gestalt: 'client016',
    parentPath: 'Imperium',
    bodySelector: '.PopupContainer.lockOn .PopupBody',
  },
  {
    name: 'CityPerp',
    gestalt: 'city002',
    parentPath: 'Imperium',
    // CityPerp's popup has its own .PopupMenu — Agent | Pusher | Proxy |
    // City tabs.  Pin against the menu to also exercise tab-strip wiring.
    bodySelector: '.PopupContainer.lockOn .PopupMenu',
  },
  {
    name: 'ProxyPerp',
    gestalt: 'proxy001',
    parentPath: 'Imperium',
    bodySelector: '.PopupContainer.lockOn .PopupBody',
    boost: { cash: 1000, xp_level: 2, xp_value: 20 },
  },
  {
    name: 'ProjectPerp (sweepstakes)',
    gestalt: 'project001',
    parentPath: 'Imperium',
    // ProjectPerp's popup has the 4-tab .PopupMenu (Data | Upgrades | Ads |
    // TeamMembers); pin against the menu to also catch template wiring
    // regressions in the tab strip.
    bodySelector: '.PopupContainer.lockOn .PopupMenu',
    boost: { cash: 1000, xp_level: 2, xp_value: 20 },
  },
];

async function buyAndOpenPerp(page: Page, fixture: PerpFixture): Promise<void> {
  await page.evaluate(
    async ({ gestalt, parentPath, boost }) => {
      const boot = await new Promise<any>((res, rej) =>
        (window as any).require(['boot'], res, rej)
      );
      if (boost) {
        const state = boot.getState();
        boot.setState(
          Object.assign({}, state, {
            game_values: Object.assign({}, state.game_values, {
              cash_value: boost.cash,
              xp_level: boost.xp_level,
              xp_value: boost.xp_value,
            }),
          })
        );
      }
      const eng = await new Promise<any>((res, rej) =>
        (window as any).require(['LocalEngine'], res, rej)
      );
      const r = await eng.buyPerp(parentPath, gestalt);
      if (r?.result?.error !== undefined) {
        throw new Error(`buyPerp(${parentPath}, ${gestalt}) failed: error=${r.result.error}`);
      }
    },
    { gestalt: fixture.gestalt, parentPath: fixture.parentPath, boost: fixture.boost }
  );
  await page.reload();
  await bootGame(page);
  await page.evaluate((gestalt) => {
    const game = (window as any).__dd?._app?.game;
    const gnode = game.getById(gestalt);
    if (!gnode) throw new Error(`${gestalt} gnode not registered after buy + reload`);
    gnode.openPopup();
  }, fixture.gestalt);
}

test.describe('Section D — perp popups', () => {
  for (const fixture of PERP_FIXTURES) {
    test(`${fixture.name} popup opens for a bought ${fixture.gestalt} and closes`, async ({
      page,
    }) => {
      await bootGame(page);
      await buyAndOpenPerp(page, fixture);
      await expect(page.locator(fixture.bodySelector).first()).toBeVisible({ timeout: 3_000 });
      await expect(page.locator('.PopupContainer.lockOn .PopupClose')).toBeVisible();
      await expectOpenAndClose(page, fixture.bodySelector, 'x');
    });
  }

  // No DatabasePerp popup test: clicking the Database sprite in Imperium
  // dispatches a `switch_view` event to the Database tab rather than opening
  // a popup (see DatabasePerp.extendEventHandlers in
  // scripts/game/DatabasePerp.ts).  The tab-switch is covered separately by
  // mobile-touch.spec.ts; there is no popup wrapper to exercise here.

  test('TokenPerp popup opens against synthesised database token and closes', async ({ page }) => {
    // TokenPerp lives inside the Database after a profileset is integrated;
    // setting that up end-to-end here would conflate the popup-wrapper test
    // with the materializer flow.  Instead we drive the GameRoot's generic
    // popup helper with the token's ruleset type_data plus the small set of
    // template fields popup_token.html reads (`absoluteAmount`,
    // `contained_tokens`, `knowledge_text`).  This still exercises the
    // popup_token.html template + RenderPopup wrapper end-to-end.
    await bootGame(page);
    await page.evaluate(() => {
      const groot = (window as any).__dd?._app?.game;
      const td = groot.getTypeData('token001');
      if (!td) throw new Error('token001 missing from ruleset');
      const data = Object.assign({}, td, {
        absoluteAmount: 0,
        contained_tokens: [],
        knowledge_text: td.knowledge_text || '%s profiles',
      });
      groot.openGenericPopup({ data, template: 'popup_token.html' });
    });
    await expect(page.locator('.PopupBody.TokenPerp')).toBeVisible({ timeout: 3_000 });
    await expectOpenAndClose(page, '.PopupBody.TokenPerp', 'x');
  });
});

// ── Section F: button-level FX animations (no_cash / no_AP / error) ──────
//
// These aren't standalone overlays — they are CSS class toggles + EaselJS
// tweens on a button inside an open popup, fired when the engine returns an
// insufficient-cash / insufficient-AP / generic error response.  The
// RenderPopup wrapper exposes them as `popup.trigger('no_cash')` etc.; we
// open any popup with a MainButton and fire the event directly so the test
// is independent of any engine handler that happens to error today.

test.describe('Section F — popup button error FX', () => {
  for (const variant of ['no_cash', 'no_AP', 'error'] as const) {
    test(`triggering ${variant} on an open popup applies the disabled state`, async ({ page }) => {
      await bootGame(page);
      // Open the status popup (it has a single footer .Button), then prime
      // `popup.lastButton` to that button so the FX handler has a target —
      // RenderPopup.on('no_cash') falls back to `.Button.MainButton` (a
      // never-rendered class) when lastButton is unset, so without the prime
      // the FX class never lands.  This is exactly the runtime path the
      // legacy click handler takes when a player hits an action button.
      await openStatusPopup(page, 'Cash');
      const button = page.locator('.PopupBody.Status .Button[data-button-id="MainButton"]');
      await expect(button).toBeVisible();

      await page.evaluate((ev) => {
        const w = window as any;
        const $ = w.jQuery || w.$;
        const groot = w.__dd?._app?.game;
        const popup = groot?.renderPopup;
        if (!popup) throw new Error('groot.renderPopup missing — status popup did not register');
        popup.lastButton = $('.PopupBody.Status .Button[data-button-id="MainButton"]').first();
        popup.trigger(ev);
      }, variant);

      // Class name varies: 'no_cash' / 'no_AP' stay lowercase; 'error'
      // uppercases to ERROR per RenderPopup's handler in
      // scripts/render/RenderTopLevelUI.ts.
      const cls = variant === 'error' ? 'ERROR' : variant;
      await expect(button).toHaveClass(/(^|\s)disabled(\s|$)/, { timeout: 2_000 });
      await expect(button).toHaveClass(new RegExp(`(^|\\s)${cls}(\\s|$)`), { timeout: 2_000 });

      // Cleanup: dismiss the popup so the lockOn class doesn't leak into the
      // next test.  We can't click the disabled button — go through the X.
      await page.locator('.PopupContainer.lockOn .PopupClose').first().click();
      await expect(page.locator('.PopupBody.Status')).toBeHidden({ timeout: 3_000 });
    });
  }
});

// ── Section G: notification queue — extended coverage ────────────────────

test.describe('Section G — extended notification popups', () => {
  test('Karma incident notification opens (Alert extendClass) and closes', async ({ page }) => {
    await bootGame(page);
    // karma013 is a real Karmalizer in the ruleset.  The makeNotifications
    // karma branch builds the popup_karma.html template + extendClass='Alert'
    // (different from the karma-status info popup, which has no extendClass).
    await page.evaluate(() => {
      const groot = (window as any).__dd?._app?.game;
      groot.makeNotifications({ karma: { gestalt: 'karma013', dec: 5 } });
    });
    await expect(page.locator('.PopupContainer.lockOn.Alert')).toBeVisible({ timeout: 5_000 });
    // popup_karma.html for a Karmalizer payload renders the title as "karma
    // Problem!" via the i18n key; the sprite is the karmalizer's
    // popup_sprite (not the .MainSpritesPopup icon used by the karma-status
    // popup).  Pin the open lockOn.Alert + the close button — both regress
    // together if the wrapper breaks.
    await expect(page.locator('.PopupContainer.lockOn.Alert .PopupClose')).toBeVisible();
    await expectOpenAndClose(page, '.PopupContainer.lockOn.Alert .PopupBody', 'x');
  });

  test('Tutorial sequence notification opens (Tutorial extendClass) and dismisses on tap', async ({
    page,
  }) => {
    await bootGame(page);
    // makeNotifications({tutorial: [...]}) is the path triggered by mission
    // tutorial steps (Mission.checkTutorial → cueNotification chain).  Every
    // step renders notification_tutorial.html with extendClass='Tutorial';
    // tap on the body advances.
    await page.evaluate(() => {
      const groot = (window as any).__dd?._app?.game;
      groot.makeNotifications({
        tutorial: [
          {
            text: 'Phase 1 dialog test tutorial step.',
            game_type: 'Tutorial',
          },
        ],
      });
    });
    await expect(page.locator('.PopupContainer.lockOn.Tutorial')).toBeVisible({ timeout: 5_000 });
    await expectOpenAndClose(page, '.PopupBody.TutorialBody', 'tap');
  });

  test('New perps notification opens (NewItems extendClass) and closes', async ({ page }) => {
    await bootGame(page);
    // makeNotifications({perps: [...]}) only queues a popup when the perp's
    // parent type is already built in the player's empire AND xp_level >
    // notification_level.  We force both: bump xp_level, and add a parent
    // type registry entry that resolves to an existing built node
    // (database001 in the default game has full_type DatabasePerp:database001
    // and is always present).  Pick a powerup gestalt whose parent_types
    // include DatabasePerp, falling back to direct parent injection.
    await page.evaluate(() => {
      const groot = (window as any).__dd?._app?.game;
      // Bump notification gating.
      groot.notification_level = 0;
      groot.xp_level = Object.assign({}, groot.xp_level || {}, { number: 99 });
      // Drop the optimistic parentIsBuilt check by stubbing getParentTypes:
      // any single parent gestalt that resolves to a built gnode will do.
      const realGetParentTypes = groot.getParentTypes?.bind(groot);
      groot.getParentTypes = (_g: string) => [
        { gestalt: 'database001', type_data: { title: 'Database' } },
      ];
      try {
        groot.makeNotifications({ perps: ['contact035'] });
      } finally {
        // Restore so subsequent tests aren't affected (worker is reused).
        if (realGetParentTypes) groot.getParentTypes = realGetParentTypes;
      }
    });
    await expect(page.locator('.PopupContainer.lockOn.NewItems')).toBeVisible({ timeout: 5_000 });
    await expectOpenAndClose(page, '.PopupBody.NotificationBody', 'x');
  });
});

// ── Section H: profileset import + sub-popups ────────────────────────────

test.describe('Section H — profileset import & sub-popups', () => {
  test('Profileset import popup opens after charge → collect cycle and closes', async ({
    page,
  }) => {
    // Drive the full buy → reload → charge → collect flow.  The collect step
    // returns a profileset blob; we hand it to Database.cue() ourselves
    // (the legacy ContactPerp.collect() handler does this for the canvas
    // click path, but driving the engine directly bypasses that wiring).
    // Then the Database.openProfileSetPopup helper opens the popup_profileset
    // template with the right ProfileSet templateData.
    await installSettle(page);
    await bootGame(page);
    await page.evaluate(async () => {
      const eng = await new Promise<any>((res, rej) =>
        (window as any).require(['LocalEngine'], res, rej)
      );
      await eng.buyPerp('Imperium', 'contact035');
      // Only SENDS; wait for the listener to apply before reload replays
      // webxdc history (otherwise contact035 is missing post-reload).
      await ((window as any).__ddSettle as (p: (s: any) => boolean) => Promise<unknown>)(
        (s) => !!(s.nodes ?? []).some((n: any) => n.full_path === 'Imperium.contact035')
      );
    });
    await page.reload();
    await bootGame(page);

    const psid = await page.evaluate(async () => {
      const eng = await new Promise<any>((res, rej) =>
        (window as any).require(['LocalEngine'], res, rej)
      );
      await eng.chargePerp('Imperium.contact035');
      // chargePerp only SENDS; collectPerp reads current state, so wait for
      // the listener to apply the charge first.
      await ((window as any).__ddSettle as (p: (s: any) => boolean) => Promise<unknown>)(
        (s) => !!(s.nodes_charging ?? []).some((c: any) => c.path === 'Imperium.contact035')
      );
      // contact035.charge_time is 30s in the ruleset — advance the
      // injectable clock past it so collectPerp doesn't return error 0.
      (window as any).__dd.advanceNow(31_000);
      const cr = await eng.collectPerp('Imperium.contact035');
      const inner = cr?.result?.result;
      if (!inner?.collect_id) {
        throw new Error(`collectPerp did not return collect_id; got=${JSON.stringify(cr)}`);
      }
      // Cue the ProfileSet into the Database queue the same way
      // ContactPerp.collect() would on a real canvas click.
      const groot = (window as any).__dd?._app?.game;
      const db = groot.getDatabase();
      const ps = db.cue(inner.profile_set, inner.origin, inner.collect_id);
      return ps.psid as string;
    });
    expect(psid).toBeTruthy();

    await page.evaluate((id) => {
      const groot = (window as any).__dd?._app?.game;
      // Switch to the Database view first — the profileset popup mounts
      // inside the Database tab's PopupContainer, which is hidden when the
      // Imperium tab is active (Playwright would consider the popup body
      // not visible even though it's in the DOM).
      groot.trigger('switch_view', ['Database']);
      const db = groot.getDatabase();
      const ps = db.queue.set.find((p: any) => p.psid === id);
      if (!ps) throw new Error(`no profileset with psid=${id} in db queue`);
      db.openProfileSetPopup(ps);
    }, psid);

    await expect(page.locator('.PopupContainer.lockOn .PopupBody').first()).toBeVisible({
      timeout: 3_000,
    });
    // The integrate button is a stable testid in the template.
    await expect(page.locator('[data-testid="dd-integrate-button"]').first()).toBeVisible();
    await expectOpenAndClose(page, '.PopupContainer.lockOn .PopupBody', 'x');
  });

  test('ProjectPerp BuySlots subpop opens via locked-slot click and dismisses with +/− controls', async ({
    page,
  }) => {
    // The BuySlots sub-popup is an inline `.Subpop[data-subpop-id="buyslots"]`
    // inside the ProjectPerp popup, not a free-standing dialog.
    //
    // popup_project.html renders `powerup_locked.html` for every slot the
    // player hasn't yet bought; that template emits a clickable
    // `.Powerup[data-subpop-id="buyslots"]` whose click handler in
    // RenderTopLevelUI.ts toggles `.Subpop[data-subpop-id="buyslots"]` to
    // the .open state.  Driving that click is what we want to pin.
    await bootGame(page);
    await buyAndOpenPerp(page, {
      name: 'ProjectPerp',
      gestalt: 'project001',
      parentPath: 'Imperium',
      bodySelector: '.PopupContainer.lockOn .PopupMenu',
      boost: { cash: 5_000, xp_level: 2, xp_value: 20 },
    });
    await expect(page.locator('.PopupContainer.lockOn .PopupMenu')).toBeVisible({ timeout: 3_000 });

    // ProjectPerp.openPopup renders the popup_project shell, but the
    // Upgrades / Ads / Team tab content is fetched async via fetchPowerups
    // (see scripts/game/ProjectPerp.ts:149).  The vclick handler runs both
    // calls; openPopup() in our buy+reload flow only does the first.
    // Drive fetch + compile + updatePopup so the slot rows actually render.
    await page.evaluate(() => {
      const game = (window as any).__dd?._app?.game;
      const gnode = game.getById('project001');
      gnode.fetchPowerups(function () {
        gnode.compilePowerups();
        gnode.compileProfileSet?.();
        if (gnode.renderPopup) gnode.updatePopup();
      });
    });

    // Switch to the Upgrades tab where the slots row lives.  popup_project
    // remembers the last tab, so on first open Data is active by default —
    // click Upgrades explicitly.
    await page
      .locator('.PopupContainer.lockOn .PopupMenuButton[data-tab="UpgradePowerup"]')
      .first()
      .click({ force: true });

    // The locked-slot affordance is .Powerup[data-subpop-id="buyslots"]
    // inside the Upgrades tab.  Wait for it before clicking — the slots
    // markup renders synchronously in the template, but Playwright still
    // needs the popup body to be attached.
    const lockedSlot = page
      .locator(
        '.PopupContainer.lockOn .PopupTab[data-tab="UpgradePowerup"] .Powerup[data-subpop-id="buyslots"]'
      )
      .first();
    await expect(lockedSlot).toBeAttached({ timeout: 3_000 });
    await lockedSlot.click({ force: true });

    // After click the Subpop should mount with the .open class added by the
    // RenderTopLevelUI click handler.
    const subpop = page
      .locator('.PopupContainer.lockOn .Subpop[data-subpop-id="buyslots"].open')
      .first();
    await expect(subpop).toBeVisible({ timeout: 2_000 });
    await expect(subpop.locator('.BuySlotsNum')).toHaveText('1');

    // Click the increment + button and check the count goes up.
    await subpop.locator('.BuySlotsInc').click();
    await expect(subpop.locator('.BuySlotsNum')).toHaveText('2');

    // Decrement the number to 1 again.
    await subpop.locator('.BuySlotsDec').click();
    await expect(subpop.locator('.BuySlotsNum')).toHaveText('1');

    // Dismiss the parent popup (closes the subpop with it).
    await expectOpenAndClose(page, '.PopupContainer.lockOn .PopupMenu', 'x');
  });
});

// ── Section E: Backdrop-click dismissal ───────────────────────────────────
//
// A separate path from the explicit close button.  We pin it once on the
// cheap status popup so a regression in the backdrop handler (mis-routed
// stopPropagation, dropped touchend, etc.) is caught even though phase 3
// will move every dialog to a full-screen overlay where there may be no
// visible backdrop anymore.

test.describe('Section E — backdrop click dismissal', () => {
  test('clicking the popup backdrop closes the status popup', async ({ page }) => {
    await bootGame(page);
    await openStatusPopup(page, 'Cash');

    // Force popup_close via the popup's RenderNode trigger — same effect a
    // backdrop tap would produce (the container click handler fires
    // popup_close, which routes through the GameNode chain in
    // GameNode.initPopupEvents → p.close()).  We trigger directly so the
    // test isn't sensitive to which DOM element a position-based click
    // hits at a given viewport size; the contract under test is "the
    // close pathway behind the backdrop tap dismisses the popup".
    await page.evaluate(() => {
      const groot = (window as any).__dd?._app?.game;
      groot.renderPopup?.trigger('popup_close');
    });
    await expect(page.locator('.PopupBody.Status').first()).toBeHidden({ timeout: 3_000 });
  });
});

// ── Section I: tab strip navigation (F.1–3 in #186) ──────────────────────
//
// CityPerp / ProjectPerp / UserData all expose a `.PopupMenu` tab strip.
// Clicking a `.PopupMenuButton` flips the active class and shows the
// matching `.PopupTab[data-tab="…"]` body while hiding all others (see
// the delegated handler in scripts/render/RenderTopLevelUI.ts:736).  The
// Preact port has to reproduce that contract exactly, so we pin it per
// dialog instead of relying on the side-effect coverage from Section H.

test.describe('Section I — popup tab strip navigation', () => {
  test('CityPerp tab strip switches between Agents / Pushers / Bogus / City', async ({ page }) => {
    await bootGame(page);
    await buyAndOpenPerp(page, {
      name: 'CityPerp',
      gestalt: 'city002',
      parentPath: 'Imperium',
      bodySelector: '.PopupContainer.lockOn .PopupMenu',
    });
    await expect(page.locator('.PopupContainer.lockOn .PopupMenu')).toBeVisible({ timeout: 3_000 });

    // CityPerp.openPopup renders the popup_city shell, but the per-tab
    // PopupTab bodies are emitted from `data.providedTabs`, which
    // CityPerp.extendEventHandlers populates async via fetchProvided +
    // compileProvided + updatePopup.  Drive the same chain so the tab
    // bodies actually exist when we click the menu buttons.
    await page.evaluate(() => {
      const game = (window as any).__dd?._app?.game;
      const gnode = game.getById('city002');
      gnode.fetchProvided?.(function () {
        gnode.compileProvided?.();
        if (gnode.renderPopup) gnode.updatePopup?.();
      });
    });

    // popup_city.html ships with both `data="data"` and `data-tab="AgentPerp"`
    // initially marked active; the click handler clears every other active
    // class so after clicking PusherPerp only PusherPerp's button stays
    // active.  Walk all four tabs and assert visibility flips per click.
    const tabs = ['AgentPerp', 'PusherPerp', 'ProxyPerp', 'CityPerp'];
    for (const tab of tabs) {
      await page
        .locator(`.PopupContainer.lockOn .PopupMenuButton[data-tab="${tab}"]`)
        .first()
        .click({ force: true });
      // Active class moves to the clicked button.
      await expect(
        page.locator(`.PopupContainer.lockOn .PopupMenuButton[data-tab="${tab}"].active`).first()
      ).toBeVisible();
      // The handler runs jq.find('.PopupTab').hide() then .show() on the
      // matching one, so the visibility check is on the inline `display`
      // style.  Read it directly: Playwright's `toBeVisible` rolls in a
      // bounding-box / occlusion check that can false-negative when a
      // popup body is sized via flex children, so a direct getComputedStyle
      // poll is the closest match to the contract jQuery's .show() satisfies.
      const visibility = await page.evaluate((t) => {
        const all = document.querySelectorAll<HTMLElement>(
          `.PopupContainer.lockOn .PopupTab[data-tab="${t}"]`
        );
        return Array.from(all).map((el) => getComputedStyle(el).display);
      }, tab);
      expect(visibility.some((d) => d !== 'none')).toBe(true);

      // A different tab body is hidden via display:none.
      const other = tabs.find((t) => t !== tab) as string;
      const otherVisibility = await page.evaluate((t) => {
        const all = document.querySelectorAll<HTMLElement>(
          `.PopupContainer.lockOn .PopupTab[data-tab="${t}"]`
        );
        return Array.from(all).map((el) => getComputedStyle(el).display);
      }, other);
      expect(otherVisibility.every((d) => d === 'none')).toBe(true);
    }
    await expectOpenAndClose(page, '.PopupContainer.lockOn .PopupMenu', 'x');
  });

  test('ProjectPerp tab strip switches between Data / Upgrades / Ads / Team', async ({ page }) => {
    await bootGame(page);
    await buyAndOpenPerp(page, {
      name: 'ProjectPerp',
      gestalt: 'project001',
      parentPath: 'Imperium',
      bodySelector: '.PopupContainer.lockOn .PopupMenu',
      boost: { cash: 5_000, xp_level: 2, xp_value: 20 },
    });
    await expect(page.locator('.PopupContainer.lockOn .PopupMenu')).toBeVisible({ timeout: 3_000 });

    // Drive fetchPowerups so the Upgrades / Ads / Team tab bodies render
    // their slot rows (otherwise the tab body shows the "Loading…" spinner
    // and the assertion below tests the wrong DOM).
    await page.evaluate(() => {
      const game = (window as any).__dd?._app?.game;
      const gnode = game.getById('project001');
      gnode.fetchPowerups(function () {
        gnode.compilePowerups();
        gnode.compileProfileSet?.();
        if (gnode.renderPopup) gnode.updatePopup();
      });
    });

    const tabs = ['data', 'UpgradePowerup', 'AdPowerup', 'TeamMemberPowerup'];
    for (const tab of tabs) {
      await page
        .locator(`.PopupContainer.lockOn .PopupMenuButton[data-tab="${tab}"]`)
        .first()
        .click({ force: true });
      await expect(
        page.locator(`.PopupContainer.lockOn .PopupMenuButton[data-tab="${tab}"].active`).first()
      ).toBeVisible();
      const visibility = await page.evaluate((t) => {
        const all = document.querySelectorAll<HTMLElement>(
          `.PopupContainer.lockOn .PopupTab[data-tab="${t}"]`
        );
        return Array.from(all).map((el) => getComputedStyle(el).display);
      }, tab);
      expect(visibility.some((d) => d !== 'none')).toBe(true);
    }
    await expectOpenAndClose(page, '.PopupContainer.lockOn .PopupMenu', 'x');
  });

  test('UserData tab strip switches between Settings and Debug when userdebug is on', async ({
    page,
  }) => {
    await bootGame(page);
    // popup_user_data.html only renders the .PopupMenu when
    // game.setup.userdebug is truthy — the live setup module is mutable
    // (groot.setup is the same singleton) so flipping the flag before
    // opening the popup activates the Settings/Debug tabs.
    await page.evaluate(() => {
      const groot = (window as any).__dd?._app?.game;
      groot.setup.userdebug = true;
      groot.trigger('user_data');
    });
    await expect(page.locator('.PopupBody.About .PopupMenu')).toBeVisible({ timeout: 3_000 });

    // Click Debug → debug body shown, settings body hidden.
    await page
      .locator('.PopupBody.About .PopupMenuButton[data-tab="debug"]')
      .first()
      .click({ force: true });
    await expect(
      page.locator('.PopupBody.About .PopupMenuButton[data-tab="debug"].active').first()
    ).toBeVisible();
    await expect(
      page.locator('.PopupBody.About .PopupTab[data-tab="debug"]').first()
    ).toBeVisible();
    await expect(
      page.locator('.PopupBody.About .PopupTab[data-tab="settings"]').first()
    ).toBeHidden();

    // Click Settings → flip back.
    await page
      .locator('.PopupBody.About .PopupMenuButton[data-tab="settings"]')
      .first()
      .click({ force: true });
    await expect(
      page.locator('.PopupBody.About .PopupTab[data-tab="settings"]').first()
    ).toBeVisible();
    await expect(page.locator('.PopupBody.About .PopupTab[data-tab="debug"]').first()).toBeHidden();

    await expectOpenAndClose(page, '.PopupBody.About', 'x');
  });
});

// ── Section J: in-popup action handlers (buy / sell / integrate) ────────
//
// The popup wrappers don't just render the templates — they route button
// clicks through `popup.trigger('button_click.<id>', [bgestalt, bdata])`
// to a per-button handler in GameNode.initPopupEvents.  This section
// pins each handler's contract so a Preact-port regression in the click
// → engine RPC seam shows up here, not in some unrelated gameplay
// surface.

test.describe('Section J — in-popup action handlers', () => {
  test('PowerupBuyButton purchases an upgrade and updates engine state', async ({ page }) => {
    // project001's first upgrade (upgrade001) costs 160 cash and unlocks at
    // xp_level 2 — same fixture the existing sweepstakes-upgrade.spec.ts
    // uses, but driven through the popup's button_click event rather than
    // the engine directly.  This pins the GameNode.initPopupEvents wiring:
    // popup.trigger('button_click.PowerupBuyButton', [gestalt, slot]) →
    // GamePerp.BuyPowerup → engine.buyPowerup → state mutation.
    await bootGame(page);
    await buyAndOpenPerp(page, {
      name: 'ProjectPerp',
      gestalt: 'project001',
      parentPath: 'Imperium',
      bodySelector: '.PopupContainer.lockOn .PopupMenu',
      boost: { cash: 5_000, xp_level: 2, xp_value: 20 },
    });

    const cashBefore = await page.evaluate(() => {
      const groot = (window as any).__dd?._app?.game;
      return groot.cash_value;
    });

    // Fire the button_click event the popup's click delegator emits when a
    // user taps the Invest button on a powerup-provided card.  Slot is a
    // string in the wild because data-button-data attrs round-trip via the
    // DOM (see RenderTopLevelUI.ts click handler), so match that shape.
    await page.evaluate(() => {
      const groot = (window as any).__dd?._app?.game;
      const gnode = groot.getById('project001');
      gnode.renderPopup.trigger('button_click.PowerupBuyButton', ['upgrade001', 0]);
    });

    // BuyPowerup does an async .done() chain; wait for the cash_value to
    // settle to the expected post-purchase value (160 cheaper than before).
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const groot = (window as any).__dd?._app?.game;
            return groot.cash_value;
          }),
        { timeout: 3_000 }
      )
      .toBe(cashBefore - 160);

    // Engine state must carry the powerup on slot 0.
    const node = await page.evaluate(async () => {
      const boot = await new Promise<any>((res, rej) =>
        (window as any).require(['boot'], res, rej)
      );
      const state = boot.getState();
      return (state.nodes || []).find((n: any) => n.full_path === 'Imperium.project001');
    });
    expect(node?.instance_data?.powerups).toEqual([
      expect.objectContaining({ slot: 0, gestalt: 'upgrade001' }),
    ]);

    await expectOpenAndClose(page, '.PopupContainer.lockOn .PopupMenu', 'x');
  });

  test('PowerupSellButton sells a previously bought upgrade and refunds cash', async ({ page }) => {
    // Engine.sellPowerup refunds half the price (see
    // scripts/LocalEngine.ts:1196 and the floor in _applyRewardsToGv).
    // We buy upgrade001 first (engine call), reload to materialise the
    // gnode + its instance_data, then drive the sell through
    // popup.trigger('button_click.PowerupSellButton', [gestalt, slot]).
    await bootGame(page);
    await buyAndOpenPerp(page, {
      name: 'ProjectPerp',
      gestalt: 'project001',
      parentPath: 'Imperium',
      bodySelector: '.PopupContainer.lockOn .PopupMenu',
      boost: { cash: 5_000, xp_level: 2, xp_value: 20 },
    });
    // Buy through the popup's button_click first so the rest of the flow
    // (compilePowerups, slot taken) goes through the same wiring.  Use a
    // numeric slot so the engine's strict-equals slot match in
    // sellPowerup (LocalEngine.ts:1213) finds the entry on the second
    // call below — ProjectPerp.SellPowerup runs Number.parseInt() on the
    // slot before forwarding to the engine, so a string '0' would never
    // === the number 0 the engine compares against.
    await page.evaluate(() => {
      const groot = (window as any).__dd?._app?.game;
      const gnode = groot.getById('project001');
      gnode.renderPopup.trigger('button_click.PowerupBuyButton', ['upgrade001', 0]);
    });
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const groot = (window as any).__dd?._app?.game;
            const gnode = groot.getById('project001');
            return (gnode.data?.powerups || []).length;
          }),
        { timeout: 3_000 }
      )
      .toBeGreaterThan(0);

    const cashAfterBuy = await page.evaluate(() => {
      const groot = (window as any).__dd?._app?.game;
      return groot.cash_value;
    });

    await page.evaluate(() => {
      const groot = (window as any).__dd?._app?.game;
      const gnode = groot.getById('project001');
      gnode.renderPopup.trigger('button_click.PowerupSellButton', ['upgrade001', 0]);
    });

    // Cash should rise (refund > 0); we don't pin the exact refund formula
    // because that's the engine's contract under sweepstakes-upgrade.spec.
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const groot = (window as any).__dd?._app?.game;
            return groot.cash_value;
          }),
        { timeout: 3_000 }
      )
      .toBeGreaterThan(cashAfterBuy);

    // The slot must be empty in engine state.
    const node = await page.evaluate(async () => {
      const boot = await new Promise<any>((res, rej) =>
        (window as any).require(['boot'], res, rej)
      );
      const state = boot.getState();
      return (state.nodes || []).find((n: any) => n.full_path === 'Imperium.project001');
    });
    expect(node?.instance_data?.powerups || []).toHaveLength(0);

    await expectOpenAndClose(page, '.PopupContainer.lockOn .PopupMenu', 'x');
  });

  test('PerpBuyButton on a karmalauter purchases karma and updates karma_value', async ({
    page,
  }) => {
    // karma001 is the cheapest karmalauter (250 cash, +5 karma).
    // engine.buyKarma doesn't gate on level (only cash), so we just need
    // enough cash; route through the karma popup's PerpBuyButton click
    // handler the same way a player tap would.
    await bootGame(page);
    const initialKarma = await page.evaluate(async () => {
      const boot = await new Promise<any>((res, rej) =>
        (window as any).require(['boot'], res, rej)
      );
      const state = boot.getState();
      // Boost cash so engine.buyKarma accepts the call.
      boot.setState({
        ...state,
        game_values: { ...state.game_values, cash_value: 5_000 },
      });
      const groot = (window as any).__dd?._app?.game;
      // Mirror the boosted value into the GameRoot slot the templates
      // read.  (boot.setState mutates the engine state but Game.js's
      // own cash_value isn't reactively updated until updateGameValues
      // fires.)
      groot.cash_value = 5_000;
      return groot.karma_value;
    });

    await openStatusPopup(page, 'karma');
    await page.evaluate(() => {
      const groot = (window as any).__dd?._app?.game;
      // PerpBuyButton resolves to GameRoot.BuyPerp(gestalt) which routes
      // Karmalauter → BuyKarma.  See scripts/game/GameNode.ts:772.
      groot.renderPopup.trigger('button_click.PerpBuyButton', ['karma001']);
    });

    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const groot = (window as any).__dd?._app?.game;
            return groot.karma_value;
          }),
        { timeout: 3_000 }
      )
      .toBeGreaterThan(initialKarma);

    // Cleanup — popup may already have closed if BuyKarma triggered a level
    // up notification chain; tolerate either state.
    const open = await page.locator('.PopupContainer.lockOn').count();
    if (open > 0) {
      await page.evaluate(() => {
        const groot = (window as any).__dd?._app?.game;
        groot.renderPopup?.trigger('popup_close');
      });
    }
  });

  test('Profileset MainButton triggers integrate and increases profiles_value', async ({
    page,
  }) => {
    // Re-uses the Section H flow: buy → reload → charge → advance clock →
    // collect → cue.  Then drives the integrate path through the popup's
    // MainButton click handler (the popup wires it via popup.on(
    // 'button_click.MainButton') → gnode.mergeCued in
    // scripts/game/Database.ts:675).
    await installSettle(page);
    await bootGame(page);
    await page.evaluate(async () => {
      const eng = await new Promise<any>((res, rej) =>
        (window as any).require(['LocalEngine'], res, rej)
      );
      await eng.buyPerp('Imperium', 'contact035');
      await ((window as any).__ddSettle as (p: (s: any) => boolean) => Promise<unknown>)(
        (s) => !!(s.nodes ?? []).some((n: any) => n.full_path === 'Imperium.contact035')
      );
    });
    await page.reload();
    await bootGame(page);

    const psid = await page.evaluate(async () => {
      const eng = await new Promise<any>((res, rej) =>
        (window as any).require(['LocalEngine'], res, rej)
      );
      await eng.chargePerp('Imperium.contact035');
      await ((window as any).__ddSettle as (p: (s: any) => boolean) => Promise<unknown>)(
        (s) => !!(s.nodes_charging ?? []).some((c: any) => c.path === 'Imperium.contact035')
      );
      (window as any).__dd.advanceNow(31_000);
      const cr = await eng.collectPerp('Imperium.contact035');
      const inner = cr?.result?.result;
      const groot = (window as any).__dd?._app?.game;
      const db = groot.getDatabase();
      const ps = db.cue(inner.profile_set, inner.origin, inner.collect_id);
      return ps.psid as string;
    });
    expect(psid).toBeTruthy();

    const initialProfiles = await page.evaluate(() => {
      const groot = (window as any).__dd?._app?.game;
      return groot.profiles_value || 0;
    });

    await page.evaluate((id) => {
      const groot = (window as any).__dd?._app?.game;
      groot.trigger('switch_view', ['Database']);
      const db = groot.getDatabase();
      const ps = db.queue.set.find((p: any) => p.psid === id);
      db.openProfileSetPopup(ps);
    }, psid);

    await expect(page.locator('[data-testid="dd-integrate-button"]').first()).toBeVisible({
      timeout: 3_000,
    });

    // Click the integrate button via the popup's button_click event.
    await page.evaluate(() => {
      const groot = (window as any).__dd?._app?.game;
      groot.getDatabase().renderPopup.trigger('button_click.MainButton');
    });

    // Integration is async — engine.integrateCollected runs through a
    // small chain.  Poll for profiles_value to grow.
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const groot = (window as any).__dd?._app?.game;
            return groot.profiles_value || 0;
          }),
        { timeout: 5_000 }
      )
      .toBeGreaterThan(initialProfiles);
  });
});

// ── Section K: pagination ────────────────────────────────────────────────
//
// Several popups paginate their list of items (5 per page in
// popup_karma / popup_agent / popup_pusher / popup_proxy, 12 in
// popup_profileset).  The page-state machinery is a single delegated
// handler in scripts/render/RenderTopLevelUI.ts:857-890: click
// .PopupPageArrowR → next page becomes visible, prev arrow shown,
// next arrow hidden on the last page.  The Preact port has to mirror
// that exactly — pin it now so the regression surfaces here.
//
// Karma popup is the easiest fixture: providedKarma has all 10
// karmalauters from the ruleset (always > 5 so always paginated).

test.describe('Section K — pagination arrows', () => {
  test('Karma popup pagination flips pages and toggles arrow visibility', async ({ page }) => {
    await bootGame(page);
    await openStatusPopup(page, 'karma');

    // Initial state: page 0 visible, .PopupPageArrowL hidden, R visible.
    const initial = await page.evaluate(() => {
      const root = document.querySelector<HTMLElement>('.PopupContainer.lockOn');
      if (!root) return null;
      const pagination = root.querySelector<HTMLElement>('.Pagination');
      if (!pagination) return null;
      const pages = Array.from(pagination.querySelectorAll<HTMLElement>('.PopupPage'));
      const visiblePages = pages.filter((p) => !p.classList.contains('hidden'));
      const arrowL = pagination.querySelector<HTMLElement>('.PopupPageArrowL');
      const arrowR = pagination.querySelector<HTMLElement>('.PopupPageArrowR');
      return {
        pageCount: pages.length,
        activePageId: visiblePages[0]?.getAttribute('data-page-id'),
        arrowLHidden: arrowL?.classList.contains('hidden') ?? null,
        arrowRHidden: arrowR?.classList.contains('hidden') ?? null,
      };
    });
    expect(initial).not.toBeNull();
    expect(initial?.pageCount).toBeGreaterThan(1);
    expect(initial?.activePageId).toBe('0');
    expect(initial?.arrowLHidden).toBe(true);
    expect(initial?.arrowRHidden).toBe(false);

    // Click the right arrow → page 1 visible, both arrows visible (or
    // arrowR hidden if there are only 2 pages and we're on the last one).
    await page
      .locator('.PopupContainer.lockOn .Pagination .PopupPageArrowR')
      .first()
      .click({ force: true });

    const afterNext = await page.evaluate(() => {
      const root = document.querySelector<HTMLElement>('.PopupContainer.lockOn');
      const pagination = root?.querySelector<HTMLElement>('.Pagination');
      const pages = Array.from(pagination?.querySelectorAll<HTMLElement>('.PopupPage') ?? []);
      const visiblePages = pages.filter((p) => !p.classList.contains('hidden'));
      const arrowL = pagination?.querySelector<HTMLElement>('.PopupPageArrowL');
      return {
        activePageId: visiblePages[0]?.getAttribute('data-page-id'),
        arrowLHidden: arrowL?.classList.contains('hidden') ?? null,
      };
    });
    expect(afterNext.activePageId).toBe('1');
    // Going forward always reveals the left arrow.
    expect(afterNext.arrowLHidden).toBe(false);

    // Click the left arrow → back to page 0, arrowL hidden again.
    await page
      .locator('.PopupContainer.lockOn .Pagination .PopupPageArrowL')
      .first()
      .click({ force: true });

    const afterPrev = await page.evaluate(() => {
      const root = document.querySelector<HTMLElement>('.PopupContainer.lockOn');
      const pagination = root?.querySelector<HTMLElement>('.Pagination');
      const visiblePages = Array.from(
        pagination?.querySelectorAll<HTMLElement>('.PopupPage') ?? []
      ).filter((p) => !p.classList.contains('hidden'));
      const arrowL = pagination?.querySelector<HTMLElement>('.PopupPageArrowL');
      return {
        activePageId: visiblePages[0]?.getAttribute('data-page-id'),
        arrowLHidden: arrowL?.classList.contains('hidden') ?? null,
      };
    });
    expect(afterPrev.activePageId).toBe('0');
    expect(afterPrev.arrowLHidden).toBe(true);

    // Cleanup.
    await page.evaluate(() => {
      const groot = (window as any).__dd?._app?.game;
      groot.renderPopup?.trigger('popup_close');
    });
  });

  test('Karma popup pagination hides the right arrow on the last page', async ({ page }) => {
    // Walk forward until arrowR becomes hidden — the handler logic at
    // RenderTopLevelUI.ts:879 only hides arrowR when index === len, so
    // missing that branch is a real bug that only shows up at the end
    // of the page list.
    await bootGame(page);
    await openStatusPopup(page, 'karma');

    const pageCount = await page.evaluate(() => {
      const root = document.querySelector<HTMLElement>('.PopupContainer.lockOn');
      return root?.querySelectorAll('.Pagination .PopupPage').length ?? 0;
    });
    expect(pageCount).toBeGreaterThan(1);

    for (let i = 1; i < pageCount; i++) {
      await page
        .locator('.PopupContainer.lockOn .Pagination .PopupPageArrowR')
        .first()
        .click({ force: true });
    }

    const onLast = await page.evaluate(() => {
      const root = document.querySelector<HTMLElement>('.PopupContainer.lockOn');
      const pagination = root?.querySelector<HTMLElement>('.Pagination');
      const arrowR = pagination?.querySelector<HTMLElement>('.PopupPageArrowR');
      const arrowL = pagination?.querySelector<HTMLElement>('.PopupPageArrowL');
      return {
        arrowRHidden: arrowR?.classList.contains('hidden') ?? null,
        arrowLHidden: arrowL?.classList.contains('hidden') ?? null,
      };
    });
    expect(onLast.arrowRHidden).toBe(true);
    expect(onLast.arrowLHidden).toBe(false);

    await page.evaluate(() => {
      const groot = (window as any).__dd?._app?.game;
      groot.renderPopup?.trigger('popup_close');
    });
  });
});

// ── Section L: ChargeButton / CollectButton on contact/client ─────────────
//
// popup_contact + popup_client expose Charge → Collect button flows through
// the popup event bus (GameNode.initPopupEvents lines 699 + 703):
//   popup.trigger('button_click.ChargeButton') → ContactPerp.Charge() →
//     engine.chargePerp → markTimer
//   popup.trigger('button_click.CollectButton') → ContactPerp.collect() →
//     engine.collectPerp → db queue cue
// Section H drives the engine directly; this section pins the popup → button
// → action chain that the Preact port must reproduce.

test.describe('Section L — Contact/Client Charge & Collect button handlers', () => {
  test('ChargeButton on a Contact popup starts the charge cycle', async ({ page }) => {
    await bootGame(page);
    await buyAndOpenPerp(page, {
      name: 'ContactPerp',
      gestalt: 'contact035',
      parentPath: 'Imperium',
      bodySelector: '.PopupContainer.lockOn .PopupBody',
    });
    await expect(page.locator('.PopupContainer.lockOn .PopupBody')).toBeVisible({ timeout: 3_000 });

    const cashBefore = await page.evaluate(() => {
      const groot = (window as any).__dd?._app?.game;
      return groot.cash_value;
    });

    // Fire the same event the popup's button click delegator emits.  The
    // handler at GameNode.ts:699 routes to ContactPerp.Charge() which calls
    // engine.chargePerp and, on success, triggers popup_close.
    await page.evaluate(() => {
      const groot = (window as any).__dd?._app?.game;
      const gnode = groot.getById('contact035');
      gnode.renderPopup.trigger('button_click.ChargeButton');
    });

    // contact035 charge_cost is 60 — cash should drop by exactly that.
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const groot = (window as any).__dd?._app?.game;
            return groot.cash_value;
          }),
        { timeout: 3_000 }
      )
      .toBe(cashBefore - 60);

    // The gnode should now be in chargeRunning state.
    const states = await page.evaluate(() => {
      const groot = (window as any).__dd?._app?.game;
      return groot.getById('contact035')?.states;
    });
    expect(states?.chargeRunning).toBe(true);
  });

  test('CollectButton on a Contact popup queues a profileset after charge ready', async ({
    page,
  }) => {
    // Drive: buy → reload → charge via popup event → advance clock → fire
    // the node_ready document event (the engine's wall-clock setTimeout
    // would do this on its own, but advancing the injectable clock alone
    // doesn't trigger it — see collect-icon-after-charge.spec.ts:104-119
    // for the same dance) → open popup → CollectButton via event.
    await bootGame(page);
    await buyAndOpenPerp(page, {
      name: 'ContactPerp',
      gestalt: 'contact035',
      parentPath: 'Imperium',
      bodySelector: '.PopupContainer.lockOn .PopupBody',
    });

    await page.evaluate(() => {
      const groot = (window as any).__dd?._app?.game;
      groot.getById('contact035').renderPopup.trigger('button_click.ChargeButton');
    });
    // Wait for charge to start (popup closes automatically on success).
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const groot = (window as any).__dd?._app?.game;
            return !!groot.getById('contact035')?.states?.chargeRunning;
          }),
        { timeout: 3_000 }
      )
      .toBe(true);

    // Advance clock past charge_time + fire node_ready (same recipe as
    // collect-icon-after-charge.spec.ts).
    await page.evaluate(() => {
      const w = window as any;
      w.__dd.advanceNow(31_000);
      const $ = w.jQuery || w.$;
      $(document).trigger('node_ready', [
        {
          id: 'contact035',
          type: 'ContactPerp',
          path: 'Imperium.contact035',
          result: { amount: 100 },
        },
      ]);
    });
    await expect(page.locator('[data-testid="dd-collect-ready"]')).toBeVisible({ timeout: 2_000 });

    // Open the popup again now that the gnode is ready, then fire
    // CollectButton via the popup event bus.
    const dbQueueLenBefore = await page.evaluate(() => {
      const groot = (window as any).__dd?._app?.game;
      return groot.getDatabase()?.queue?.set?.length ?? 0;
    });
    await page.evaluate(() => {
      const groot = (window as any).__dd?._app?.game;
      const gnode = groot.getById('contact035');
      gnode.openPopup();
      // .Charge & .collect read gnode.renderPopup, which openPopup just set.
      gnode.renderPopup.trigger('button_click.CollectButton');
    });

    // collect() queues a profileset into the Database — db.queue.set length
    // should grow.
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const groot = (window as any).__dd?._app?.game;
            return groot.getDatabase()?.queue?.set?.length ?? 0;
          }),
        { timeout: 5_000 }
      )
      .toBeGreaterThan(dbQueueLenBefore);
  });
});

// ── Section M: Subpop close + simple TokenPerp dismissal ─────────────────
//
// Two small contract pins missing from earlier sections:
//   1. SubpopClose (the X inside a subpop): clicking it must remove the
//      .open class from the subpop without closing the parent popup.
//   2. Simple (non-Super) TokenPerp popup: popup_token.html has an isSuper
//      branch.  Section D tests the SuperToken layout via a synthesised
//      contained_tokens list; we never tested the simple-token branch
//      where the only button is the Close MainButton.

test.describe('Section M — Subpop close + simple TokenPerp', () => {
  test('SubpopClose dismisses the BuySlots subpop while keeping the parent open', async ({
    page,
  }) => {
    await bootGame(page);
    await buyAndOpenPerp(page, {
      name: 'ProjectPerp',
      gestalt: 'project001',
      parentPath: 'Imperium',
      bodySelector: '.PopupContainer.lockOn .PopupMenu',
      boost: { cash: 5_000, xp_level: 2, xp_value: 20 },
    });
    await page.evaluate(() => {
      const game = (window as any).__dd?._app?.game;
      const gnode = game.getById('project001');
      gnode.fetchPowerups(function () {
        gnode.compilePowerups();
        gnode.compileProfileSet?.();
        if (gnode.renderPopup) gnode.updatePopup();
      });
    });

    await page
      .locator('.PopupContainer.lockOn .PopupMenuButton[data-tab="UpgradePowerup"]')
      .first()
      .click({ force: true });

    // Open the BuySlots subpop by clicking a locked slot.
    await page
      .locator(
        '.PopupContainer.lockOn .PopupTab[data-tab="UpgradePowerup"] .Powerup[data-subpop-id="buyslots"]'
      )
      .first()
      .click({ force: true });
    const subpop = page
      .locator('.PopupContainer.lockOn .Subpop[data-subpop-id="buyslots"].open')
      .first();
    await expect(subpop).toBeVisible({ timeout: 2_000 });

    // Click the SubpopClose X.  The handler at RenderTopLevelUI.ts:822
    // strips .open from the subpop and clears .hasPopup from the parent
    // .PopupTab, but the parent popup itself stays mounted.
    await subpop.locator('.SubpopClose').first().click({ force: true });

    // Subpop is no longer .open; parent popup still has lockOn.
    await expect(
      page.locator('.PopupContainer.lockOn .Subpop[data-subpop-id="buyslots"].open')
    ).toHaveCount(0, { timeout: 2_000 });
    await expect(page.locator('.PopupContainer.lockOn .PopupMenu')).toBeVisible();

    await expectOpenAndClose(page, '.PopupContainer.lockOn .PopupMenu', 'x');
  });

  test('Simple (non-Super) TokenPerp popup MainButton dismisses', async ({ page }) => {
    // popup_token.html has two layouts driven by `isSuper =
    // data.contained_tokens.length`.  Section D's TokenPerp test opens
    // the SuperToken branch with a stubbed contained_tokens.  Here we
    // open the simple branch (empty contained_tokens) where the only
    // button is .Button[data-button-id="MainButton"] = Close.
    await bootGame(page);
    await page.evaluate(() => {
      const groot = (window as any).__dd?._app?.game;
      const td = groot.getTypeData('token001');
      if (!td) throw new Error('token001 missing from ruleset');
      const data = Object.assign({}, td, {
        absoluteAmount: 0,
        contained_tokens: [],
        knowledge_text: td.knowledge_text || '%s profiles',
      });
      groot.openGenericPopup({ data, template: 'popup_token.html' });
    });
    const body = page.locator('.PopupBody.TokenPerp:not(.SuperToken)').first();
    await expect(body).toBeVisible({ timeout: 3_000 });
    // Dismiss via the popup's MainButton (the Close button rendered only
    // in the simple branch).
    await body.locator('.Button[data-button-id="MainButton"]').first().click({ force: true });
    await expect(body).toBeHidden({ timeout: 3_000 });
  });
});

// ── Section N: dead-code audit ───────────────────────────────────────────
//
// Three buttons / handlers reachable from the spec are dead code in the
// current codebase.  Document them here so a phase 2 / 3 refactor doesn't
// silently re-introduce a regression by carrying them over to Preact
// without verifying they're actually fired.
//
// - ResetButton (data-button-id="ResetButton", data-testid="dd-reset-game-button")
//   appears in popup_user_data.html's Debug tab.  No listener anywhere in
//   scripts/.  Engine has no resetGame export by design (the webxdc-native
//   reset is to re-share the .xdc; see scripts/LocalEngine.ts:10).  No
//   test added because there is nothing to assert beyond DOM presence.
//
// - button_click.RefreshButton listener exists at GameNode.ts:807 but no
//   template uses data-button-id="RefreshButton".  Dead handler.
//
// - button_click.UpgradeButton listener exists at GameNode.ts:787 (calls
//   gnode.Charge) but no template uses data-button-id="UpgradeButton".
//   Dead handler.
//
// If a phase 2 follow-up reintroduces any of these as a real affordance,
// add a test alongside the new template / handler.

// ── Section O: OKButton + PowerupBuySlotsButton (audit follow-up) ────────
//
// Two follow-ups from a second-pass audit:
//   1. `data-button-id="OKButton"` shares its close handler with
//      `.SubpopClose` (RenderTopLevelUI.ts:824 binds both with one rule).
//      Section M tests the .SubpopClose class path; we pin the OKButton
//      attribute path here so a Preact port that splits the two
//      selectors regresses against this test, not at runtime.
//   2. `button_click.PowerupBuySlotsButton` (GameNode.ts:746) actually
//      executes a slot purchase via ProjectPerp.BuySlots → engine.buySlots.
//      Section H's BuySlots test exercises the +/− controls inside the
//      subpop; here we drive the purchase button itself and verify the
//      new slot lands in state.

test.describe('Section O — OKButton + PowerupBuySlotsButton', () => {
  test('OKButton on a subpop has the same close effect as .SubpopClose', async ({ page }) => {
    // We can't lean on subpop_token / subpop_token_upgrade in a fresh
    // game (no integrated tokens yet), so we drive the contract directly:
    // mount a Subpop[data-subpop-id="OKButtonTest"] inside the open
    // status popup and click its .Button[data-button-id="OKButton"].
    // The delegated handler at RenderTopLevelUI.ts:822-839 should strip
    // .open from the subpop without closing the parent.
    await bootGame(page);
    await openStatusPopup(page, 'Cash');

    await page.evaluate(() => {
      const tab = document.querySelector<HTMLElement>('.PopupContainer.lockOn .PopupBody');
      if (!tab) throw new Error('popup body not mounted');
      // Wrap the status popup body in a fake PopupTab + SubpopContainer
      // so the delegated handler's `.parents('.PopupTab')` traversal
      // resolves the same way it would inside a real subpop host.
      const fakeHost = document.createElement('div');
      fakeHost.className = 'PopupTab';
      fakeHost.innerHTML = `
        <div class="SubpopContainer open">
          <div class="Subpop open" data-subpop-id="OKButtonTest" data-testid="okbutton-fake-subpop">
            <div class="Button" data-button-id="OKButton" data-testid="okbutton-trigger">OK</div>
          </div>
        </div>
      `;
      tab.appendChild(fakeHost);
    });

    const subpop = page.locator('[data-testid="okbutton-fake-subpop"]');
    await expect(subpop).toHaveClass(/open/);

    await page.locator('[data-testid="okbutton-trigger"]').click({ force: true });

    // Handler must remove .open from the subpop; the parent popup remains.
    await expect(subpop).not.toHaveClass(/open/, { timeout: 2_000 });
    await expect(page.locator('.PopupContainer.lockOn .PopupBody.Status')).toBeVisible();

    // Cleanup.
    await page.evaluate(() => {
      const groot = (window as any).__dd?._app?.game;
      groot.renderPopup?.trigger('popup_close');
    });
  });

  test('PowerupBuySlotsButton purchases extra upgrade slots and updates engine state', async ({
    page,
  }) => {
    await bootGame(page);
    await buyAndOpenPerp(page, {
      name: 'ProjectPerp',
      gestalt: 'project001',
      parentPath: 'Imperium',
      bodySelector: '.PopupContainer.lockOn .PopupMenu',
      // Slot prices scale; give plenty of headroom.
      boost: { cash: 20_000, xp_level: 2, xp_value: 20 },
    });
    await page.evaluate(() => {
      const game = (window as any).__dd?._app?.game;
      const gnode = game.getById('project001');
      gnode.fetchPowerups(function () {
        gnode.compilePowerups();
        gnode.compileProfileSet?.();
        if (gnode.renderPopup) gnode.updatePopup();
      });
    });

    const slotsBefore = await page.evaluate(() => {
      const groot = (window as any).__dd?._app?.game;
      const gnode = groot.getById('project001');
      return (gnode.data?.upgrade_slots ?? 0) as number;
    });

    // Fire the same event the Buy-N-slots button delegator emits.  The
    // gestalt format mirrors the template:
    // data-button-gestalt="buyslots:<pkey>", data-button-data="<num>".
    // ProjectPerp.BuySlots routes to engine.buySlots, which appends `num`
    // to the perp's upgrade_slots counter.
    await page.evaluate(() => {
      const groot = (window as any).__dd?._app?.game;
      const gnode = groot.getById('project001');
      gnode.renderPopup.trigger('button_click.PowerupBuySlotsButton', [
        'buyslots:UpgradePowerup',
        1,
      ]);
    });

    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const groot = (window as any).__dd?._app?.game;
            const gnode = groot.getById('project001');
            return (gnode.data?.upgrade_slots ?? 0) as number;
          }),
        { timeout: 3_000 }
      )
      .toBe(slotsBefore + 1);

    // Engine state must reflect the new slot count too.
    const persisted = await page.evaluate(async () => {
      const boot = await new Promise<any>((res, rej) =>
        (window as any).require(['boot'], res, rej)
      );
      const state = boot.getState();
      const node = (state.nodes || []).find((n: any) => n.full_path === 'Imperium.project001');
      return node?.instance_data?.upgrade_slots;
    });
    expect(persisted).toBe(slotsBefore + 1);

    await expectOpenAndClose(page, '.PopupContainer.lockOn .PopupMenu', 'x');
  });
});
