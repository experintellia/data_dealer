/**
 * Mobile dialog tests (issue #80 follow-up).
 *
 * Verifies the additions on top of the phase-8 PR3 baseline:
 *   - the About popup (UserData) is CSS-centered on a mobile viewport
 *     (i.e. its bounding rect is near the viewport centre regardless of
 *     the JS-computed transform).
 *   - the popup carries `role="dialog"` + `aria-modal="true"` for a11y.
 *   - pressing Escape closes the popup (NoClose modals are exempt, but
 *     the About dialog isn't NoClose).
 */

import { expect, test } from '@playwright/test';

test.use({ viewport: { width: 390, height: 844 } });

async function openAboutDialog(page: import('@playwright/test').Page) {
  await page.evaluate(() => {
    const el = document.querySelector<HTMLElement>('#UserData');
    if (!el) throw new Error('#UserData missing');
    el.dispatchEvent(
      new TouchEvent('touchstart', { bubbles: true, cancelable: true, touches: [] as any })
    );
    el.dispatchEvent(
      new TouchEvent('touchend', { bubbles: true, cancelable: true, touches: [] as any })
    );
  });
}

test('mobile-dialog: about popup is CSS-centered horizontally', async ({ page }) => {
  await page.goto('/?devtools=1');
  await expect(page.locator('[data-testid="game-container"]')).toBeVisible({
    timeout: 50_000,
  });

  await openAboutDialog(page);
  const popup = page.locator('.PopupContainer.lockOn .Popup').first();
  await expect(popup).toBeVisible({ timeout: 5_000 });

  const layout = await page.evaluate(() => {
    const popup = document.querySelector<HTMLElement>('.PopupContainer.lockOn .Popup');
    if (!popup) return null;
    const r = popup.getBoundingClientRect();
    return {
      vw: window.innerWidth,
      left: r.left,
      right: r.right,
      width: r.width,
      computedTransform: getComputedStyle(popup).transform,
    };
  });
  expect(layout).not.toBeNull();
  if (!layout) return;
  // Centred: the popup's centre should be near the viewport centre (within
  // 10 px to allow rounding from the flex layout).
  const popupCentre = (layout.left + layout.right) / 2;
  expect(Math.abs(popupCentre - layout.vw / 2)).toBeLessThan(10);
  // Width should fit within the viewport (max-width: 92vw on mobile).
  expect(layout.width).toBeLessThanOrEqual(layout.vw);
});

test('mobile-dialog: popup has dialog role + aria-modal', async ({ page }) => {
  await page.goto('/?devtools=1');
  await expect(page.locator('[data-testid="game-container"]')).toBeVisible({
    timeout: 50_000,
  });

  await openAboutDialog(page);
  const popup = page.locator('.PopupContainer.lockOn .Popup').first();
  await expect(popup).toBeVisible({ timeout: 5_000 });
  await expect(popup).toHaveAttribute('role', 'dialog');
  await expect(popup).toHaveAttribute('aria-modal', 'true');
});

test('mobile-dialog: ESC closes the popup', async ({ page }) => {
  await page.goto('/?devtools=1');
  await expect(page.locator('[data-testid="game-container"]')).toBeVisible({
    timeout: 50_000,
  });

  // Snapshot how many popups are open before we add the About dialog so we
  // can verify that ESC removes exactly one (the new one), not a stale one
  // left behind from the boot tutorial.
  const before = await page.locator('.PopupContainer.lockOn .Popup').count();

  await openAboutDialog(page);
  await expect(page.locator('.PopupContainer.lockOn .Popup')).toHaveCount(before + 1, {
    timeout: 5_000,
  });

  await page.evaluate(() => {
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true })
    );
  });

  // The Popup.close path adds a `close` class then removes the element after
  // the transition.  We poll the visible count until it returns to the
  // pre-About baseline.
  await expect
    .poll(async () => page.locator('.PopupContainer.lockOn .Popup').count(), { timeout: 5_000 })
    .toBeLessThanOrEqual(before);
});
