/**
 * Visual regression coverage for the dialogs being refit for mobile.
 *
 * Captures each dialog at two viewports — iPhone SE (375×667) and a
 * canonical desktop (1280×800) — and diffs against committed baseline
 * snapshots.  Goals:
 *
 *  1. Catch a mobile-targeted CSS change accidentally leaking into the
 *     desktop layout (every mobile rule lives inside
 *     `@media (max-width: 768px)`, but selectors that override a
 *     base-style at desktop too will show up in the desktop snapshot).
 *  2. Give a reviewer side-by-side before/after PNGs so a deliberate
 *     visual change can be approved by updating the baseline with
 *     `--update-snapshots`.
 *
 * Workflow on a deliberate visual change:
 *   pnpm test:e2e tests/e2e/dialog-screenshots.spec.ts --update-snapshots
 *
 * Per-dialog tests use the same dialog-open paths as
 * `dialog-lifecycle.spec.ts` so a future Preact rewrite or template
 * tweak keeps the snapshots meaningful.  Add a new test pair per
 * dialog as it gets a mobile-friendly fix.
 */

import { type Page, expect, test } from '@playwright/test';

const IPHONE_SE = { width: 375, height: 667 };
const DESKTOP = { width: 1280, height: 800 };

async function boot(page: Page, vp: { width: number; height: number }): Promise<void> {
  await page.setViewportSize(vp);
  await page.goto('/?devtools=1');
  await expect(page.locator('[data-testid="game-container"]')).toBeVisible({ timeout: 50_000 });
  const picker = page.locator('.LangSelectOverlay');
  if (await picker.isVisible().catch(() => false)) {
    await picker.locator('.lang-pick[data-locale="en"]').click();
    await expect(page.locator('[data-testid="game-container"]')).toBeVisible({ timeout: 50_000 });
  }
  await page.waitForFunction(() => !!(window as any).__dd?._app?.game);
  // Hide the @webxdc/vite-plugins simulator's "webxdc dev tools" panel
  // (Add Peer / Reset).  It's appended to body via JS with an inline
  // style (z-index: 9999, position: fixed, bottom: 1em, left: 1em) and
  // covers the bottom-left of the viewport — including the corner of
  // the dialog under test on phone viewports.
  await page.addStyleTag({
    content:
      'body > div[style*="z-index: 9999"][style*="position: fixed"] { display: none !important; }',
  });
  // Pre-mark mission briefings as seen so the auto-queued boot tutorial
  // doesn't refill the queue while we're trying to open a specific
  // dialog under test.
  await page.evaluate(() => {
    const groot = (window as any).__dd?._app?.game;
    if (!groot?.raw_data) return;
    groot.raw_data.mission_briefings_seen = groot.raw_data.mission_briefings_seen || {};
    for (const g of Object.keys(groot.Missions?.Missions ?? {})) {
      groot.raw_data.mission_briefings_seen[g] = true;
    }
  });
  // Hard-drain mirrors dialog-lifecycle.spec.ts: keep closing whatever
  // is open until the queue + slot + DOM stay empty for 3 ticks past
  // the 250–500ms re-mount timer in RenderPopup.close.
  let stable = 0;
  for (let i = 0; i < 40; i++) {
    const settled = await page.evaluate(() => {
      const g = (window as any).__dd?._app?.game;
      if (!g) return false;
      if (Array.isArray(g.NotificationQueue)) g.NotificationQueue.length = 0;
      g?.notificationPopup?.trigger?.('popup_close');
      document.querySelectorAll<HTMLElement>('.Popup').forEach((el) => el.remove());
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

/** Wait long enough for the popup's open-scale animation
 *  (`AniScaleOpacity 0.2s reverse` on `.PopupBody.TutorialBody`) and
 *  any flex reflow to settle before screenshotting. */
async function waitForPopupSettle(page: Page): Promise<void> {
  await page.waitForTimeout(400);
}

async function openTutorialSimpleMessage(page: Page): Promise<void> {
  await page.evaluate(() => {
    const groot = (window as any).__dd?._app?.game;
    groot.makeNotifications({
      simplemessage: {
        text: "Hey there! My name's Marco, and I'll be your personal advisor. Ready?",
      },
    });
  });
  await expect(page.locator('.PopupBody.TutorialBody').first()).toBeVisible({ timeout: 5_000 });
  await waitForPopupSettle(page);
}

async function openMissionBriefing(page: Page, gestalt: string): Promise<void> {
  await page.evaluate((g) => {
    const groot = (window as any).__dd?._app?.game;
    if (groot.raw_data?.mission_briefings_seen) {
      delete groot.raw_data.mission_briefings_seen[g];
    }
    groot.makeNotifications({ mission_active: g });
  }, gestalt);
  await expect(page.locator('.PopupContainer.lockOn.Mission').first()).toBeVisible({
    timeout: 8_000,
  });
  await expect(page.locator('.PopupBody.MissionBody').first()).toBeVisible({ timeout: 5_000 });
  await waitForPopupSettle(page);
}

/** Tutorial / story popup, dismiss-on-tap.  Same shape as LevelUp. */
test.describe('Tutorial / simplemessage', () => {
  test('mobile (iPhone SE)', async ({ page }) => {
    await boot(page, IPHONE_SE);
    await openTutorialSimpleMessage(page);
    await expect(page).toHaveScreenshot('tutorial-iphone-se.png', { fullPage: false });
  });

  test('desktop (1280×800)', async ({ page }) => {
    await boot(page, DESKTOP);
    await openTutorialSimpleMessage(page);
    await expect(page).toHaveScreenshot('tutorial-desktop.png', { fullPage: false });
  });
});

/** Mission briefing — the user-visible "new mission" popup with goals,
 *  rewards, and a Marco speech bubble.  `mission001` has 1 goal +
 *  1 reward (compact); `mission006` has 3 goals + 2 rewards (stress
 *  test for the mobile inner-scroll fallback). */
test.describe('Mission briefing — mission001 (single goal)', () => {
  test('mobile (iPhone SE)', async ({ page }) => {
    await boot(page, IPHONE_SE);
    await openMissionBriefing(page, 'mission001');
    await expect(page).toHaveScreenshot('mission001-iphone-se.png', { fullPage: false });
  });

  test('desktop (1280×800)', async ({ page }) => {
    await boot(page, DESKTOP);
    await openMissionBriefing(page, 'mission001');
    await expect(page).toHaveScreenshot('mission001-desktop.png', { fullPage: false });
  });
});

test.describe('Mission briefing — mission006 (3 goals, scrollable on mobile)', () => {
  test('mobile (iPhone SE)', async ({ page }) => {
    await boot(page, IPHONE_SE);
    await openMissionBriefing(page, 'mission006');
    await expect(page).toHaveScreenshot('mission006-iphone-se.png', { fullPage: false });
  });

  test('desktop (1280×800)', async ({ page }) => {
    await boot(page, DESKTOP);
    await openMissionBriefing(page, 'mission006');
    await expect(page).toHaveScreenshot('mission006-desktop.png', { fullPage: false });
  });
});

/** Cash status popup — opened via `click_status.Cash`.  Uses the
 *  Stage-level `.PopupContainer.Top.NoClose` overlay (z-index 100000)
 *  with the same generic `.PopupBody` (width:588 on desktop) every
 *  other status info popup uses.  Mobile baseline pins the
 *  generic-`.PopupBody` width fit (D-2). */
async function openStatusCash(page: Page): Promise<void> {
  await page.evaluate(() => {
    const groot = (window as any).__dd?._app?.game;
    groot.trigger('click_status.Cash');
  });
  await expect(page.locator('.PopupBody.Status').first()).toBeVisible({ timeout: 5_000 });
  await waitForPopupSettle(page);
}

test.describe('Status info popup — Cash', () => {
  test('mobile (iPhone SE)', async ({ page }) => {
    await boot(page, IPHONE_SE);
    await openStatusCash(page);
    await expect(page).toHaveScreenshot('status-cash-iphone-se.png', { fullPage: false });
  });

  test('desktop (1280×800)', async ({ page }) => {
    await boot(page, DESKTOP);
    await openStatusCash(page);
    await expect(page).toHaveScreenshot('status-cash-desktop.png', { fullPage: false });
  });
});

/** Contact perp popup — buys contact035 (Jessica) and opens the
 *  resulting perp popup, the dialog the user flagged in task D for
 *  both the statusbar-overlap and the generic-width issue. */
async function openContactJessica(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const eng = await new Promise<any>((res, rej) =>
      (window as any).require(['LocalEngine'], res, rej)
    );
    const r = await eng.buyPerp('Imperium', 'contact035');
    if (r?.result?.error !== undefined) {
      throw new Error(`buyPerp failed: error=${r.result.error}`);
    }
  });
  await page.reload();
  // re-run the boot drain — the page just reloaded.
  await page.waitForFunction(() => !!(window as any).__dd?._app?.game);
  await page.evaluate(() => {
    const groot = (window as any).__dd?._app?.game;
    if (!groot?.raw_data) return;
    groot.raw_data.mission_briefings_seen = groot.raw_data.mission_briefings_seen || {};
    for (const g of Object.keys(groot.Missions?.Missions ?? {})) {
      groot.raw_data.mission_briefings_seen[g] = true;
    }
  });
  let stable = 0;
  for (let i = 0; i < 40; i++) {
    const settled = await page.evaluate(() => {
      const g = (window as any).__dd?._app?.game;
      if (!g) return false;
      if (Array.isArray(g.NotificationQueue)) g.NotificationQueue.length = 0;
      g?.notificationPopup?.trigger?.('popup_close');
      document.querySelectorAll<HTMLElement>('.Popup').forEach((el) => el.remove());
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
    if (stable >= 3) break;
    await page.waitForTimeout(300);
  }
  await page.addStyleTag({
    content:
      'body > div[style*="z-index: 9999"][style*="position: fixed"] { display: none !important; }',
  });

  // Mirror the canvas vclick handler in ContactPerp.extendEventHandlers:
  // before opening, it materialises `data.ProfileSet` from
  // `data.tokens`.  We don't need the real ProfileSet class here — the
  // popup VM only reads `data.ProfileSet?.tokens_set` (see
  // contactView.ts:46), and per-token rendering in tokenView.ts reads
  // `token.data` (set by ProfileSet's constructor to
  // `groot.getTypeData(gestalt)`).  Inline the same enrichment so the
  // token sprite grid renders with proper labels + logos, matching a
  // real canvas tap.
  await page.evaluate(() => {
    const game = (window as any).__dd?._app?.game;
    const gnode = game.getById('contact035');
    if (!gnode) throw new Error('contact035 gnode not registered');
    const data = gnode.data as any;
    const groot = (window as any).__dd?._app?.game;
    const enriched = (data.tokens ?? []).map((t: { gestalt?: string }) => ({
      ...t,
      data: t.gestalt ? groot.getTypeData(t.gestalt) : undefined,
    }));
    data.ProfileSet = { tokens_set: enriched };
    gnode.openPopup();
  });
  await expect(page.locator('.PopupContainer.lockOn .PopupBody').first()).toBeVisible({
    timeout: 5_000,
  });
  await waitForPopupSettle(page);
}

test.describe('Contact perp popup — contact035 (Jessica)', () => {
  test('mobile (iPhone SE)', async ({ page }) => {
    await boot(page, IPHONE_SE);
    await openContactJessica(page);
    await expect(page).toHaveScreenshot('contact035-iphone-se.png', { fullPage: false });
  });

  test('desktop (1280×800)', async ({ page }) => {
    await boot(page, DESKTOP);
    await openContactJessica(page);
    await expect(page).toHaveScreenshot('contact035-desktop.png', { fullPage: false });
  });
});
