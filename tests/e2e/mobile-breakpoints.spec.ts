/**
 * Header breakpoint contract (issue #80 follow-up).
 *
 * The user explicitly chose where the header should change shape:
 *   - ≥ 981 px : desktop layout — brand logo visible, in-stage XP item
 *                shows in the statusbar, tabs inline-block on a single row
 *   - ≤ 980 px : logo hidden — the only change.  Tabs reclaim the logo's
 *                space; XP bar is still served by the in-stage Statusbar
 *                copy (NOT yet relocated to the header).
 *   - ≤ 926 px : two-row header — tabs drop to row 2, the cloned XP/level
 *                bar appears in row 1, the in-stage Statusbar XP item is
 *                hidden so the same data isn't shown twice.
 *
 * This spec pins those decisions so a future cleanup doesn't silently
 * shift the breakpoints.
 */

import { expect, test } from '@playwright/test';

async function bootAt(page: import('@playwright/test').Page, w: number, h: number) {
  await page.setViewportSize({ width: w, height: h });
  await page.goto('/?devtools=1');
  await expect(page.locator('[data-testid="game-container"]')).toBeVisible({
    timeout: 50_000,
  });
}

test('breakpoint ≥ 981: logo visible, .mm-xp hidden', async ({ page }) => {
  await bootAt(page, 1024, 800);
  const state = await page.evaluate(() => {
    const logo = document.querySelector<HTMLElement>('.MainMenuLogo');
    const xp = document.querySelector<HTMLElement>('.mm-xp');
    return {
      logoDisplay: logo ? getComputedStyle(logo).display : null,
      xpDisplay: xp ? getComputedStyle(xp).display : null,
    };
  });
  expect(state.logoDisplay).not.toBe('none');
  expect(state.xpDisplay).toBe('none');
});

test('breakpoint ≤ 980: logo hidden, XP NOT yet relocated to header', async ({ page }) => {
  await bootAt(page, 960, 800);
  const state = await page.evaluate(() => {
    const logo = document.querySelector<HTMLElement>('.MainMenuLogo');
    const xpClone = document.querySelector<HTMLElement>('.mm-xp');
    const inStageXp = document.querySelector<HTMLElement>('.Statusbar .StatusItem.XP');
    return {
      logoDisplay: logo ? getComputedStyle(logo).display : null,
      xpCloneDisplay: xpClone ? getComputedStyle(xpClone).display : null,
      inStageXpDisplay: inStageXp ? getComputedStyle(inStageXp).display : null,
    };
  });
  // Logo is hidden so the tabs can reclaim its space.
  expect(state.logoDisplay).toBe('none');
  // XP clone is NOT yet shown — we only relocate at ≤ 926.
  expect(state.xpCloneDisplay).toBe('none');
  // The in-stage Statusbar XP item is still visible (it's the source of
  // truth at this breakpoint).
  expect(state.inStageXpDisplay).not.toBe('none');
});

test('breakpoint ≤ 926: cloned XP bar appears + in-stage XP hidden', async ({ page }) => {
  await bootAt(page, 900, 800);
  const state = await page.evaluate(() => {
    const xpClone = document.querySelector<HTMLElement>('.mm-xp');
    const inStageXp = document.querySelector<HTMLElement>('.Statusbar .StatusItem.XP');
    return {
      xpCloneDisplay: xpClone ? getComputedStyle(xpClone).display : null,
      inStageXpDisplay: inStageXp ? getComputedStyle(inStageXp).display : null,
    };
  });
  expect(state.xpCloneDisplay).not.toBe('none');
  expect(state.inStageXpDisplay).toBe('none');
});

test('breakpoint ≤ 926: two-row header (tabs below XP slot)', async ({ page }) => {
  await bootAt(page, 900, 800);
  const state = await page.evaluate(() => {
    const xp = document.querySelector<HTMLElement>('.mm-xp');
    const tabs = document.querySelector<HTMLElement>('.mm-tabs');
    if (!xp || !tabs) return null;
    const xpRect = xp.getBoundingClientRect();
    const tabsRect = tabs.getBoundingClientRect();
    return {
      // Row 2: tab strip's top is at or below the XP slot's bottom
      tabsBelowXp: tabsRect.top >= xpRect.bottom - 1,
      tabsDisplay: getComputedStyle(tabs).display,
    };
  });
  expect(state).not.toBeNull();
  if (!state) return;
  expect(state.tabsBelowXp, 'tabs should sit on row 2 below the XP slot').toBe(true);
  expect(state.tabsDisplay, 'tab strip should be a flex container at ≤926').toBe('flex');
});
