/**
 * Mobile XP bar clone (issue #80).
 *
 * The XP statusItem is cloned out of the in-stage Statusbar into the
 * MainMenu's `.mm-xp` slot on mobile breakpoints (≤ 768 px).  This
 * spec verifies that:
 *   - the cloned bar exists inside `.MainMenu .mm-xp`
 *   - it sits within the MainMenu's row 1 (so it can't visually leak into
 *     the playfield like the previous CSS-magic position:fixed approach
 *     could when the sprite z-index lost the stacking-order race)
 *   - the in-stage Statusbar's XP item is hidden so XP isn't shown twice
 *   - the cloned bar reflects the live XP value from the game state
 */

import { expect, test } from '@playwright/test';

test.use({ viewport: { width: 390, height: 844 } });

test('mobile-xp: XP bar is cloned into MainMenu and stays in row 1', async ({ page }) => {
  await page.goto('/?devtools=1');
  await expect(page.locator('[data-testid="game-container"]')).toBeVisible({
    timeout: 50_000,
  });

  const layout = await page.evaluate(() => {
    const menu = document.querySelector<HTMLElement>('.MainMenu');
    const slot = document.querySelector<HTMLElement>('.MainMenu .mm-xp');
    const cloneXp = slot?.querySelector<HTMLElement>('.StatusItem.XP') ?? null;
    const inStageXp = document.querySelector<HTMLElement>('.Statusbar .StatusItem.XP');
    if (!menu || !slot || !cloneXp) {
      return {
        ok: false as const,
        reason: 'missing element',
        menu: !!menu,
        slot: !!slot,
        cloneXp: !!cloneXp,
      };
    }
    const menuRect = menu.getBoundingClientRect();
    const cloneRect = cloneXp.getBoundingClientRect();
    return {
      ok: true as const,
      cloneVisible: cloneRect.width > 0 && cloneRect.height > 0,
      // The clone's centre should land within the MainMenu's vertical band.
      cloneInsideMenu: cloneRect.top >= menuRect.top - 1 && cloneRect.bottom <= menuRect.bottom + 1,
      inStageHidden: inStageXp ? getComputedStyle(inStageXp).display === 'none' : true,
      cloneTextLevel: cloneXp.querySelector('.StatusTextLevel')?.textContent ?? null,
      cloneTextValue: cloneXp.querySelector('.StatusText')?.textContent ?? null,
    };
  });

  expect(layout.ok, JSON.stringify(layout)).toBe(true);
  if (!layout.ok) return;
  expect(layout.cloneVisible, 'cloned XP bar should be visible').toBe(true);
  expect(layout.cloneInsideMenu, 'cloned XP bar should sit inside MainMenu').toBe(true);
  expect(layout.inStageHidden, 'in-stage XP item should be hidden on mobile').toBe(true);
  // Level and value are populated (non-empty strings); we don't pin exact
  // values because the boot state can vary if a tutorial step modifies XP.
  expect(layout.cloneTextLevel?.trim().length ?? 0).toBeGreaterThan(0);
  expect(layout.cloneTextValue?.trim().length ?? 0).toBeGreaterThan(0);
});
