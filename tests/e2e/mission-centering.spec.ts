/**
 * Mission tab centring (issue #80).
 *
 * Pins the fix for the issue the user reported: mission cards rendered
 * left-aligned (off-centre) inside the Missions ViewTab.
 *
 * Root cause: `MissionPerp.draw()` (the JS class for each mission card)
 * called `Node.setSize(getSize())`, which writes inline `width: 0px;
 * height: 0px` because `MissionPerp.prototype` doesn't override the
 * Node defaults of 0/0.  That inline width: 0 beat the CSS
 * `.MissionPerp { width: 570px }`, so `margin: 12px auto` couldn't
 * centre a 0-wide block.
 *
 * Fix: stub `MissionPerp.prototype.setSize` (Render.js) so sizing is
 * purely CSS-driven for the mission card — same pattern
 * MissionPerp already uses for setPosition / setTransform.
 *
 * This spec asserts the rendered card centre lines up with the
 * ViewTab centre (within a few pixels for sub-pixel rounding).
 */

import { expect, test } from '@playwright/test';

const VIEWPORTS = [
  { name: '1024 (desktop)', width: 1024, height: 800 },
  { name: '960 (narrow desktop)', width: 960, height: 800 },
  { name: '880 (tablet)', width: 880, height: 800 },
  { name: '600 (phone landscape)', width: 600, height: 800 },
  { name: '390 (phone portrait)', width: 390, height: 844 },
];

for (const vp of VIEWPORTS) {
  test(`mission cards centred at ${vp.name}`, async ({ page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.goto('/?devtools=1');
    await expect(page.locator('[data-testid="game-container"]')).toBeVisible({
      timeout: 50_000,
    });

    await page.locator('.mm-tab[data-button-id="Missions"]').dispatchEvent('click');
    await page.waitForTimeout(800);

    const layout = await page.evaluate(() => {
      const view = document.querySelector<HTMLElement>('.ViewTab.active');
      const cards = Array.from(
        document.querySelectorAll<HTMLElement>('.ViewTab.active .MissionPerp')
      );
      if (!view || cards.length === 0) return null;
      const v = view.getBoundingClientRect();
      const visible = cards.filter((c) => {
        const r = c.getBoundingClientRect();
        return r.width > 1 && r.height > 1;
      });
      return {
        viewCentre: (v.left + v.right) / 2,
        cards: visible.map((c) => {
          const r = c.getBoundingClientRect();
          return { centre: (r.left + r.right) / 2, w: r.width };
        }),
      };
    });

    expect(layout, 'mission view + cards should render').not.toBeNull();
    if (!layout) return;
    expect(layout.cards.length, 'at least one visible mission card').toBeGreaterThan(0);
    for (const c of layout.cards) {
      expect(c.w, 'card should not be 0-wide (the bug)').toBeGreaterThan(100);
      expect(
        Math.abs(c.centre - layout.viewCentre),
        `card centre ${c.centre} should match view centre ${layout.viewCentre}`
      ).toBeLessThan(10);
    }
  });
}
