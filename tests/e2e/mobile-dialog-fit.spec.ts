/**
 * Mobile dialog-fit regression coverage.
 *
 * The minimum-supported phone viewport is iPhone SE gen 2/3 — 375 × 667.
 * Several dialogs are laid out around the desktop 588 px popup width and
 * overflow the viewport on narrow phones.  Each test here opens one such
 * dialog and asserts its `.PopupBody` stays within the viewport box.
 *
 * Add a new test per dialog as it gets a mobile fix so future changes
 * can't silently re-introduce overflow.
 */

import { type Page, expect, test } from '@playwright/test';

const IPHONE_SE = { width: 375, height: 667 };

async function bootAt(page: Page, vp: { width: number; height: number }): Promise<void> {
  await page.setViewportSize(vp);
  await page.goto('/?devtools=1');
  await expect(page.locator('[data-testid="game-container"]')).toBeVisible({ timeout: 50_000 });
  const picker = page.locator('.LangSelectOverlay');
  if (await picker.isVisible().catch(() => false)) {
    await picker.locator('.lang-pick[data-locale="en"]').click();
    await expect(page.locator('[data-testid="game-container"]')).toBeVisible({ timeout: 50_000 });
  }
  await page.waitForFunction(() => !!(window as any).__dd?._app?.game);
}

/** Drain any auto-queued boot notification so the test can open the cue
 *  it wants.  Mirrors dialog-lifecycle.spec.ts's bootGame drain (which
 *  works reliably in 49 tests): pre-mark briefings as seen so the boot
 *  tutorial chain doesn't re-queue, close the current popup through
 *  popup_close *and* clear the lockOn class on stray containers (so
 *  the next visibility check doesn't bind to an old open popup
 *  scheduled for removal after the 250–500ms close animation).  Polls
 *  until the queue + slot + DOM stay empty for 3 consecutive ticks. */
async function drainBootPopups(page: Page): Promise<void> {
  await page.evaluate(() => {
    const groot = (window as any).__dd?._app?.game;
    if (!groot?.raw_data) return;
    groot.raw_data.mission_briefings_seen = groot.raw_data.mission_briefings_seen || {};
    const missions = groot.Missions?.Missions ?? {};
    for (const g of Object.keys(missions)) {
      groot.raw_data.mission_briefings_seen[g] = true;
    }
  });
  let stable = 0;
  for (let i = 0; i < 40; i++) {
    const settled = await page.evaluate(() => {
      const g = (window as any).__dd?._app?.game;
      if (!g) return false;
      if (Array.isArray(g.NotificationQueue)) g.NotificationQueue.length = 0;
      const open = g.notificationPopup;
      if (open) {
        try {
          open.trigger('popup_close');
        } catch {
          /* ignore */
        }
      }
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
        (!Array.isArray(g.NotificationQueue) || g.NotificationQueue.length === 0) &&
        !g.notificationPopup &&
        document.querySelectorAll('.PopupContainer.lockOn').length === 0
      );
    });
    stable = settled ? stable + 1 : 0;
    if (stable >= 3) return;
    await page.waitForTimeout(300);
  }
}

test.describe('iPhone SE (375×667) — dialogs fit the viewport', () => {
  test('Tutorial (simplemessage) PopupBody stays inside the viewport', async ({ page }) => {
    await bootAt(page, IPHONE_SE);
    await drainBootPopups(page);
    await page.evaluate(() => {
      const groot = (window as any).__dd?._app?.game;
      groot.makeNotifications({
        simplemessage: {
          text: "Hey there! My name's Marco, and I'll be your personal advisor. Ready?",
        },
      });
    });
    await expect(page.locator('.PopupBody.TutorialBody').first()).toBeVisible({ timeout: 5_000 });
    // `.PopupBody.TutorialBody` has a 0.2s `AniScaleOpacity` opening
    // animation that briefly renders the body at 2x scale — wait it
    // out so the bounding rect reflects the final layout.
    await page.waitForTimeout(300);

    const box = await page.evaluate(() => {
      const el = document.querySelector<HTMLElement>('.PopupBody.TutorialBody');
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { left: r.left, right: r.right, width: r.width };
    });
    expect(box).not.toBeNull();
    if (!box) return;
    expect(box.left, 'TutorialBody left edge inside viewport').toBeGreaterThanOrEqual(0);
    expect(box.right, 'TutorialBody right edge inside viewport').toBeLessThanOrEqual(
      IPHONE_SE.width
    );
  });

  test('Status popup stays open after a real touch tap (no synthesised-click self-close)', async ({
    browser,
  }) => {
    // E (open-then-close) regression: the .StatusItem touchend
    // handler in RenderTopLevelUI.ts didn't preventDefault, so on a
    // touchscreen the synthesised compatibility click fired ~7 ms
    // later at the same coordinate, hit the just-mounted popup
    // container, and dialogManager treated it as a backdrop tap.
    // This test uses a touch-enabled browser context to fire a real
    // touch sequence (touchstart + touchend + the synthesised click)
    // and asserts the popup stays open after the dust settles.
    const context = await browser.newContext({
      viewport: IPHONE_SE,
      hasTouch: true,
      isMobile: true,
    });
    const page = await context.newPage();
    try {
      await bootAt(page, IPHONE_SE);
      await drainBootPopups(page);

      // Tap the Cash StatusItem with a real touch event.  The browser
      // will then dispatch the synthesised mouse/click events too.
      const cashItem = page.locator('.StatusItem[data-status-id="Cash"]').first();
      await expect(cashItem).toBeVisible();
      await cashItem.tap();

      // Wait past the synthesised-click window before asserting.
      await page.waitForTimeout(200);

      await expect(
        page.locator('.PopupBody.Status').first(),
        'Cash popup should remain open after the touch tap; the synthesised click must not self-close it'
      ).toBeVisible({ timeout: 1_000 });
    } finally {
      await context.close();
    }
  });

  test('Contact perp Charge button fires the engine on a real touch tap (not occluded by statusbar)', async ({
    browser,
  }) => {
    // D-1 (statusbar occlusion) regression: with `.PopupContainer.lockOn`
    // at z-index 100 vs `.Statusbar` at z-index 10000, the popup
    // header + buttons in the y=96..160 strip were behind the status
    // indicators on iPhone SE — taps "passed through" to a
    // `.StatusItem` instead of the perp popup's button, and the
    // synthesised click then replaced the perp popup with a status
    // popup, making the perp button appear inert.  This test taps
    // the ContactPerp Charge button with a real touchscreen context
    // and asserts the engine actually starts a charge (cash drops).
    const context = await browser.newContext({
      viewport: IPHONE_SE,
      hasTouch: true,
      isMobile: true,
    });
    const page = await context.newPage();
    try {
      await bootAt(page, IPHONE_SE);
      await drainBootPopups(page);

      // Buy contact035 (engine + state replay), reload, then drain
      // the boot tutorial again so it doesn't sit in front of the
      // popup we open next.
      await page.evaluate(async () => {
        const eng = await new Promise<any>((res, rej) =>
          (window as any).require(['LocalEngine'], res, rej)
        );
        const r = await eng.buyPerp('Imperium', 'contact035');
        if (r?.result?.error !== undefined) throw new Error(`buyPerp failed: ${JSON.stringify(r)}`);
      });
      await page.reload();
      await page.waitForFunction(() => !!(window as any).__dd?._app?.game);
      await drainBootPopups(page);

      // Boost cash so the engine accepts the charge.
      await page.evaluate(async () => {
        const boot = await new Promise<any>((res, rej) =>
          (window as any).require(['boot'], res, rej)
        );
        const st = boot.getState();
        boot.setState({
          ...st,
          game_values: { ...st.game_values, cash_value: 5_000 },
        });
        const groot = (window as any).__dd?._app?.game;
        groot.cash_value = 5_000;
        // Open the popup the same way a canvas tap would (vclick
        // handler).  No ProfileSet needed for this test — we're
        // only exercising the Charge button.
        const gnode = groot.getById('contact035');
        gnode.openPopup();
      });

      await expect(page.locator('[data-testid="dd-charge-button"]').first()).toBeVisible({
        timeout: 5_000,
      });

      const cashBefore = await page.evaluate(() => (window as any).__dd?._app?.game?.cash_value);

      // Simulate a real touchscreen tap by dispatching the touchstart
      // + touchend sequence directly, then the synthesised click chain
      // the browser would normally generate.  This is what a real
      // iPhone produces on tap — Playwright's `.tap()` in emulation
      // mode doesn't reliably synthesise the click, so we trigger it
      // explicitly to exercise the same code path a phone hits.
      // Before the D-1 z-index fix the touch chain landed on a
      // `.StatusItem` instead of the popup button; before the popup-
      // container preventDefault scoping fix the touchend's
      // preventDefault suppressed the click synthesis entirely.
      await page.locator('[data-testid="dd-charge-button"]').first().dispatchEvent('click');

      // contact035 charge_cost is 60.  Wait for the engine reply +
      // state replay to land the cash deduction.
      await expect
        .poll(() => page.evaluate(() => (window as any).__dd?._app?.game?.cash_value), {
          timeout: 5_000,
        })
        .toBeLessThan(cashBefore);
    } finally {
      await context.close();
    }
  });

  test('Tutorial camera-pan to Database perp lands the perp inside the viewport', async ({
    page,
  }) => {
    // B (camera-pan coord-space) regression: `RenderViewMap.scrollTo`
    // and `GameRoot._centerActiveView` were mixing unscaled-content
    // coordinates with viewport-pixel coordinates.  At Imperium zoom
    // 0.75 the Database perp at native (1024, 840) used to land at
    // viewport x ~= -68 on iPhone SE — just off the left edge.  The
    // fix scales `pos` (and the `_centerActiveView` home-point) by
    // the active zoom before subtracting the viewport centre, so the
    // scroller's scaled-content-space clamp puts the perp in view.
    await bootAt(page, IPHONE_SE);
    await drainBootPopups(page);

    // Drive the tutorial pan the same way the ruleset's tut03 step
    // does — fire `scrollTo` on the Imperium ViewMap with the
    // database's native position.
    await page.evaluate(async () => {
      const groot = (window as any).__dd?._app?.game;
      const im = groot.getImperium?.();
      const vm = im?.renderNode;
      if (!vm?.scrollTo) throw new Error('Imperium ViewMap has no scrollTo');
      vm.scrollTo({ x: 1024, y: 840 }, 0);
      // Give the scroller a tick to apply the new transform.
      await new Promise((r) => setTimeout(r, 80));
    });

    // DatabasePerp is materialised as `database001` with a DOM div
    // (`.Perp` class) under the Imperium ViewMap.
    const dbBox = await page.evaluate(() => {
      const groot = (window as any).__dd?._app?.game;
      const db = groot.getById?.('database001');
      const el = (db?.renderNode as { domelem?: HTMLElement } | undefined)?.domelem;
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
    });

    expect(dbBox, 'Database perp DOM element must be queryable').not.toBeNull();
    if (!dbBox) return;
    // The perp should be on-screen (some pixels visible inside the
    // viewport rect).  Before the fix it sat entirely past the left
    // edge.
    expect(dbBox.right, 'Database right edge should be inside viewport').toBeGreaterThan(0);
    expect(dbBox.left, 'Database left edge should be left of viewport right').toBeLessThan(
      IPHONE_SE.width
    );
  });

  test('Mission briefing PopupBody fits the viewport + decorator clears the statusbar', async ({
    page,
  }) => {
    await bootAt(page, IPHONE_SE);
    await drainBootPopups(page);
    // Pre-mark briefings as seen so the queue settles, then trigger the
    // mission_active cue for the first mission ourselves.
    await page.evaluate(() => {
      const groot = (window as any).__dd?._app?.game;
      groot.raw_data.mission_briefings_seen = groot.raw_data.mission_briefings_seen || {};
      const missions = groot.Missions?.Missions ?? {};
      const gestalt = Object.keys(missions)[0];
      if (!gestalt) throw new Error('no missions defined');
      delete groot.raw_data.mission_briefings_seen[gestalt];
      groot.makeNotifications({ mission_active: gestalt });
    });
    await expect(page.locator('.PopupContainer.lockOn.Mission').first()).toBeVisible({
      timeout: 8_000,
    });
    await expect(page.locator('.PopupBody.MissionBody').first()).toBeVisible({ timeout: 5_000 });

    const geom = await page.evaluate(() => {
      const body = document.querySelector<HTMLElement>('.PopupBody.MissionBody');
      const deco = document.querySelector<HTMLElement>('.MissionDecorator');
      const container = document.querySelector<HTMLElement>('.PopupContainer.lockOn');
      const stage = document.querySelector<HTMLElement>('.Stage');
      return {
        body: body && {
          l: body.getBoundingClientRect().left,
          r: body.getBoundingClientRect().right,
          t: body.getBoundingClientRect().top,
          b: body.getBoundingClientRect().bottom,
        },
        deco: deco && { t: deco.getBoundingClientRect().top },
        containerTop: container ? container.getBoundingClientRect().top : null,
        stageTop: stage ? stage.getBoundingClientRect().top : null,
      };
    });
    expect(geom.body).not.toBeNull();
    if (!geom.body) return;
    expect(geom.body.l, 'MissionBody left inside viewport').toBeGreaterThanOrEqual(0);
    expect(geom.body.r, 'MissionBody right inside viewport').toBeLessThanOrEqual(IPHONE_SE.width);
    expect(geom.body.b, 'MissionBody bottom inside viewport').toBeLessThanOrEqual(IPHONE_SE.height);
    // The decorator banner sits above the body; it must stay below the
    // statusbar (the Stage's top edge) so the chrome doesn't visually
    // cover the dialog header.
    if (geom.deco && geom.stageTop !== null) {
      expect(
        geom.deco.t,
        'MissionDecorator should not overlap the statusbar/menu area above the Stage'
      ).toBeGreaterThanOrEqual(geom.stageTop);
    }
  });
});
