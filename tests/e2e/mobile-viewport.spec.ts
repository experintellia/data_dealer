/**
 * Mobile viewport smoke test (issue #80, phase 8).
 *
 * Boots the game at common phone-portrait viewports and verifies that:
 *   - the game container is visible
 *   - the document does not horizontally overflow (no page-level scroll bar)
 *
 * Touch-event coverage lives in PR 2; tap-target / legibility in PR 3.
 */

import { expect, test } from '@playwright/test';

const VIEWPORTS = [
  { name: 'iPhone-SE', width: 360, height: 640 },
  { name: 'iPhone-13', width: 390, height: 844 },
  { name: 'iPhone-XR', width: 414, height: 896 },
];

for (const vp of VIEWPORTS) {
  test(`mobile (${vp.name}, ${vp.width}x${vp.height}): boots without horizontal overflow`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.goto('/?devtools=1');

    await expect(page.locator('[data-testid="game-container"]')).toBeVisible({
      timeout: 50_000,
    });

    // Wait for the post-render fitToWindow to size the Stage to the viewport.
    await page.waitForFunction(
      (target) => {
        const stage = document.querySelector<HTMLElement>('.Stage');
        return !!stage && Math.abs(stage.getBoundingClientRect().width - target) < 5;
      },
      vp.width,
      { timeout: 10_000 }
    );

    // The body must not be wider than the viewport — horizontal scroll on a
    // phone is the most common mobile-layout regression.
    const overflow = await page.evaluate(() => ({
      bodyScrollWidth: document.body.scrollWidth,
      bodyClientWidth: document.body.clientWidth,
      docScrollWidth: document.documentElement.scrollWidth,
      docClientWidth: document.documentElement.clientWidth,
    }));
    expect(overflow.docScrollWidth).toBeLessThanOrEqual(overflow.docClientWidth + 1);
    expect(overflow.bodyScrollWidth).toBeLessThanOrEqual(overflow.bodyClientWidth + 1);
  });
}
