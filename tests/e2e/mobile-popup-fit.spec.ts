/**
 * Popup / dialog responsiveness on narrow viewports (PR #181 regression guard).
 *
 * Three properties are verified at common phone widths (360, 390, 414 px):
 *   1. The About popup's rendered bounding box doesn't overflow the viewport.
 *   2. The popup has a CSS scale transform applied (scale < 1 at these widths).
 *   3. Pagination arrows are display:none via the ≤ 768 px media query.
 *
 * The About dialog is used because it is always reachable through #UserData
 * without needing any game-state setup (no perps to buy, no missions to start).
 */

import { expect, test } from '@playwright/test';

const VIEWPORTS = [
  { name: '360', width: 360, height: 640 },
  { name: '390', width: 390, height: 844 },
  { name: '414', width: 414, height: 896 },
];

async function openAboutDialog(page: import('@playwright/test').Page) {
  await page.evaluate(() => {
    const el = document.querySelector<HTMLElement>('#UserData');
    if (!el) throw new Error('#UserData not found');
    el.dispatchEvent(
      new TouchEvent('touchstart', { bubbles: true, cancelable: true, touches: [] as any })
    );
    el.dispatchEvent(
      new TouchEvent('touchend', { bubbles: true, cancelable: true, touches: [] as any })
    );
  });
  await expect(page.locator('.PopupContainer.lockOn')).toBeVisible({ timeout: 5_000 });
  // Allow the CSS opacity transition to finish before measuring geometry.
  await page.waitForTimeout(400);
}

for (const vp of VIEWPORTS) {
  test(`popup bounding box fits viewport (${vp.name}px wide)`, async ({ page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.goto('/?devtools=1');
    await expect(page.locator('[data-testid="game-container"]')).toBeVisible({ timeout: 50_000 });

    await openAboutDialog(page);

    const bounds = await page.evaluate(() => {
      const popup = document.querySelector<HTMLElement>('.PopupContainer.lockOn .Popup');
      if (!popup) return null;
      const r = popup.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, vw: window.innerWidth };
    });

    expect(bounds, 'Popup element not found').not.toBeNull();
    if (!bounds) return;

    expect(bounds.left, 'popup clips left edge').toBeGreaterThanOrEqual(-1);
    expect(bounds.right, 'popup overflows right edge').toBeLessThanOrEqual(bounds.vw + 1);
  });

  test(`popup is scaled down via CSS transform (${vp.name}px wide)`, async ({ page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.goto('/?devtools=1');
    await expect(page.locator('[data-testid="game-container"]')).toBeVisible({ timeout: 50_000 });

    await openAboutDialog(page);

    // getBoundingClientRect reflects the post-transform rendered size.
    // The native popup design width is 600 px; at these narrow viewports the
    // scale should bring the rendered width well below 600 px.
    const renderedWidth = await page.evaluate(() => {
      const popup = document.querySelector<HTMLElement>('.PopupContainer.lockOn .Popup');
      return popup ? popup.getBoundingClientRect().width : null;
    });

    expect(renderedWidth, 'could not measure popup width').not.toBeNull();
    // At all three viewports, 94 vw / 612 < 1, so the popup must be narrower
    // than its native 600 px design width.
    expect(renderedWidth!).toBeLessThan(600);
  });

  test(`pagination arrows are hidden at ${vp.name}px wide`, async ({ page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.goto('/?devtools=1');
    await expect(page.locator('[data-testid="game-container"]')).toBeVisible({ timeout: 50_000 });

    // Inject a bare arrow element to check the media-query rule without
    // needing an open perp popup (perps require game-state setup).
    const display = await page.evaluate(() => {
      const probe = document.createElement('div');
      probe.className = 'PopupPageArrowR';
      probe.style.cssText = 'position:absolute;left:-9999px;';
      document.body.appendChild(probe);
      const d = getComputedStyle(probe).display;
      document.body.removeChild(probe);
      return d;
    });

    expect(display, 'PopupPageArrowR should be display:none at ≤768px').toBe('none');
  });
}
