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
  // Drain the entire NotificationQueue and tear down any already-open
  // notification popup so each test opens its dialog on a clean slate.
  // We also pre-mark all mission briefings as seen so the next reload
  // doesn't re-queue the tutorial.
  await page.evaluate(() => {
    const groot = (window as any).__dd?._app?.game;
    if (!groot) return;
    if (groot.notificationPopup) {
      const p = groot.notificationPopup;
      try {
        p.jdomelem?.remove?.();
      } catch {
        /* ignore — best-effort teardown */
      }
      delete groot.notificationPopup;
    }
    if (Array.isArray(groot.NotificationQueue)) {
      groot.NotificationQueue.length = 0;
    }
    // Mark every known mission briefing as seen.
    if (groot.raw_data) {
      groot.raw_data.mission_briefings_seen = groot.raw_data.mission_briefings_seen || {};
      const missions = groot.Missions?.Missions ?? {};
      for (const g of Object.keys(missions)) {
        groot.raw_data.mission_briefings_seen[g] = true;
      }
    }
    document
      .querySelectorAll<HTMLElement>('.PopupContainer.lockOn')
      .forEach((el) => el.classList.remove('lockOn'));
  });

  await expect(page.locator('.PopupContainer.lockOn')).toHaveCount(0, { timeout: 3_000 });
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
    // Click in the top-left corner of the container — outside the centered
    // popup body so the backdrop receives the click.  An element-level
    // .click() targets the container regardless of children, which means
    // jQuery's container handler fires; using a position click simulates
    // the user touching the backdrop area instead.
    await page
      .locator('.PopupContainer.lockOn')
      .first()
      .click({ position: { x: 5, y: 5 }, force: true });
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

test.describe('Section D — perp popups', () => {
  test('ContactPerp popup opens for a bought contact and closes', async ({ page }) => {
    await bootGame(page);
    // Buy a free contact through the engine, then reload so Game.js
    // materialises the new gnode (engine.buyPerp updates state but the
    // GameRoot only hydrates new perps on game-load).
    await page.evaluate(async () => {
      const eng = await new Promise<any>((res, rej) =>
        (window as any).require(['LocalEngine'], res, rej)
      );
      await eng.buyPerp('Imperium', 'contact035');
    });
    await page.reload();
    await bootGame(page);
    await page.evaluate(() => {
      const game = (window as any).__dd?._app?.game;
      const gnode = game.getById('contact035');
      if (!gnode) throw new Error('contact035 gnode not registered after buy');
      gnode.openPopup();
    });
    await expect(page.locator('.PopupContainer.lockOn')).toBeVisible({ timeout: 3_000 });
    // contact popup uses popup_contact.html → renders into the generic
    // .PopupBody.  Asserting the close button is the most stable open marker.
    await expect(page.locator('.PopupContainer.lockOn .PopupClose')).toBeVisible();
    await expectOpenAndClose(page, '.PopupContainer.lockOn .PopupBody', 'x');
  });

  test('ProjectPerp (sweepstakes) popup opens after buying project001 and closes', async ({
    page,
  }) => {
    await bootGame(page);
    // project001 needs xp_level 2 + 300 cash; raise both then buy + open.
    await page.evaluate(async () => {
      const boot = await new Promise<any>((res, rej) =>
        (window as any).require(['boot'], res, rej)
      );
      const state = boot.getState();
      boot.setState(
        Object.assign({}, state, {
          game_values: Object.assign({}, state.game_values, {
            cash_value: 1000,
            xp_level: 2,
            xp_value: 20,
          }),
        })
      );
      const eng = await new Promise<any>((res, rej) =>
        (window as any).require(['LocalEngine'], res, rej)
      );
      await eng.buyPerp('Imperium', 'project001');
    });
    await page.reload();
    await bootGame(page);
    await page.evaluate(() => {
      const game = (window as any).__dd?._app?.game;
      const gnode = game.getById('project001');
      if (!gnode) throw new Error('project001 gnode not registered after buy');
      gnode.openPopup();
    });
    // ProjectPerp popup has the 4-tab .PopupMenu on Data | Upgrades | Ads |
    // TeamMembers — assert at least one tab button rendered.
    await expect(page.locator('.PopupContainer.lockOn .PopupMenu')).toBeVisible({
      timeout: 3_000,
    });
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
    await expectOpenAndClose(page, '.PopupBody.Status', 'backdrop');
  });
});
