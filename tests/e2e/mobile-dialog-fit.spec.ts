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
 *  it wants without an unrelated popup sitting in front. */
async function drainBootPopups(page: Page): Promise<void> {
  for (let i = 0; i < 20; i++) {
    const open = await page.locator('.PopupContainer.lockOn').count();
    if (open === 0) return;
    await page.evaluate(() => {
      const groot = (window as any).__dd?._app?.game;
      if (Array.isArray(groot?.NotificationQueue)) groot.NotificationQueue.length = 0;
      groot?.notificationPopup?.trigger?.('popup_close');
    });
    await page.waitForTimeout(200);
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
});
