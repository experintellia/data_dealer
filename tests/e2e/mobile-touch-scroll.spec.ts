/**
 * Native touch scrolling vs. the ViewMap's window-level touchmove.
 *
 * The ViewMap feeds the Zynga scroller from a non-passive `touchmove`
 * listener on `window`.  It used to `preventDefault()` every touchmove
 * on the page, so a swipe on an `overflow-y:auto` ViewTab (Missions /
 * Leaderboard) never scrolled on a phone.  Only gestures that started a
 * map drag may be swallowed; the map itself must still pan by touch.
 *
 * Real touch input goes through CDP `Input.dispatchTouchEvent` so the
 * browser's own scroll handling runs (synthetic `TouchEvent`s don't
 * scroll anything).
 */

import { type Page, expect, test } from '@playwright/test';
import { bootGame } from './_helpers';

test.use({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
});

async function touchDrag(page: Page, x: number, y: number, dx: number, dy: number): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  for (let i = 1; i <= 10; i++) {
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: x + (dx * i) / 10, y: y + (dy * i) / 10 }],
    });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}

test('touch-drag scrolls a ViewTab natively', async ({ page }) => {
  await bootGame(page);
  await page.locator('.mm-tab[data-button-id="Missions"]').dispatchEvent('click');
  await expect(page.locator('#Missions.ViewTab.active')).toBeVisible();
  // Boot state has too few missions to overflow a phone screen — pad it.
  await page.evaluate(() => {
    const pad = document.createElement('div');
    pad.style.height = '3000px';
    document.querySelector('#Missions .ViewTabContainer')?.appendChild(pad);
  });
  const scrollTop = () => page.evaluate(() => document.querySelector('#Missions')?.scrollTop ?? 0);
  expect(await scrollTop()).toBe(0);

  await touchDrag(page, 195, 700, 0, -400);

  await expect.poll(scrollTop).toBeGreaterThan(100);
});

test('touch-drag still pans the ViewMap', async ({ page }) => {
  await bootGame(page);
  await expect(page.locator('#Imperium.ViewMap.active')).toBeVisible();
  const mapPos = () =>
    page.evaluate(() => {
      const r = document.querySelector('#Imperium .ViewMapContainer')?.getBoundingClientRect();
      return { x: r?.left ?? 0, y: r?.top ?? 0 };
    });
  // Empty map background (clear of the centred Database perp, whose own
  // touch handler would start a perp drag instead).
  expect(await page.evaluate(() => document.elementFromPoint(330, 650)?.className)).toBe(
    'ViewMapContainer'
  );
  const before = await mapPos();

  await touchDrag(page, 330, 650, -120, -120);

  await expect.poll(async () => (await mapPos()).y).toBeLessThan(before.y - 50);
  expect((await mapPos()).x).toBeLessThan(before.x - 50);
});
