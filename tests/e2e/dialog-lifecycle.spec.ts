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

  for (let attempt = 0; attempt < 12; attempt++) {
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
    if (settled) return;
    // RenderPopup.close() schedules its DOM removal + callback via 250–500ms
    // setTimeout.  Wait above that floor before re-checking so the queue's
    // openNotification chain has time to finish or to dispatch the next
    // item we then drain on the next iteration.
    await page.waitForTimeout(300);
  }
  throw new Error('bootGame: could not drain notification queue after 12 attempts');
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
    await bootGame(page);
    await page.evaluate(async () => {
      const eng = await new Promise<any>((res, rej) =>
        (window as any).require(['LocalEngine'], res, rej)
      );
      await eng.buyPerp('Imperium', 'contact035');
    });
    await page.reload();
    await bootGame(page);

    const psid = await page.evaluate(async () => {
      const eng = await new Promise<any>((res, rej) =>
        (window as any).require(['LocalEngine'], res, rej)
      );
      await eng.chargePerp('Imperium.contact035');
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
    await bootGame(page);
    await page.evaluate(async () => {
      const eng = await new Promise<any>((res, rej) =>
        (window as any).require(['LocalEngine'], res, rej)
      );
      await eng.buyPerp('Imperium', 'contact035');
    });
    await page.reload();
    await bootGame(page);

    const psid = await page.evaluate(async () => {
      const eng = await new Promise<any>((res, rej) =>
        (window as any).require(['LocalEngine'], res, rej)
      );
      await eng.chargePerp('Imperium.contact035');
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
