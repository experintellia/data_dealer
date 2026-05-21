/**
 * Two mission-card / dialog regression guards:
 *
 *  1. Spacing — `.MissionGoal.small` is `display:inline-block` with no
 *     horizontal margin on desktop.  The legacy `mission_goal_small.html`
 *     loop emitted newlines between elements and leaned on the
 *     inline-block whitespace gap; a Preact `.map()` renders adjacent
 *     siblings with no whitespace, so the pills collapse flush.  Spacing
 *     must come from an explicit `margin`, not source whitespace.
 *
 *  2. Dialog modality — `dialogManager` mounts each dialog in a
 *     full-screen overlay that covers the `.MainMenu` header, and dims
 *     the header (`.MainMenu.DialogLock`) so it reads as part of the
 *     darkened backdrop.  A click over the header area lands on the
 *     overlay and dismisses the dialog, so a tab can't be switched
 *     from under it.
 */

import { expect, test } from '@playwright/test';
import { bootGame } from './_helpers';

interface DDGame {
  raw_data?: { mission_briefings_seen?: Record<string, boolean> };
  Missions?: { Missions?: Record<string, unknown> };
  makeNotifications?(arg: { mission_active: string }): void;
}
interface DDWindow {
  __dd?: { _app?: { game?: DDGame } };
}

test('mission-card small goal pills keep explicit horizontal spacing', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 800 });
  await bootGame(page);
  await page.locator('.mm-tab[data-button-id="Missions"]').dispatchEvent('click');
  // Wait for the view switch to commit — the menu marks the clicked tab
  // active synchronously with the view becoming `.ViewTab.active`.
  // Pills inside non-active mission cards are `display:none`, so we
  // can't `toBeVisible` on them; we read computed margin via
  // `querySelector` below (resolves regardless of ancestor visibility).
  await expect(page.locator('.mm-tab.active[data-button-id="Missions"]')).toBeVisible();

  const margins = await page.evaluate(() => {
    const pill = document.querySelector<HTMLElement>('.ViewTab.active .MissionGoal.small');
    if (!pill) return null;
    const cs = getComputedStyle(pill);
    return { left: Number.parseFloat(cs.marginLeft), right: Number.parseFloat(cs.marginRight) };
  });

  expect(margins, 'at least one small goal pill should render').not.toBeNull();
  if (!margins) return;
  // Before the fix these were 0 on desktop (spacing came only from the
  // now-absent inter-element whitespace).
  expect(margins.left, 'small pill needs left margin').toBeGreaterThan(0);
  expect(margins.right, 'small pill needs right margin').toBeGreaterThan(0);
});

test('an open dialog dims the header and a tab click dismisses it without switching', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1024, height: 800 });
  await bootGame(page);

  const activeTabId = await page.locator('.mm-tab.active').first().getAttribute('data-button-id');
  expect(activeTabId, 'a game tab should be active on boot').toBeTruthy();
  // Pick a different tab to attempt switching to from under the dialog.
  const otherTab = page.locator('.mm-tab:not(.active):not(.disabled)').first();
  const otherTabId = await otherTab.getAttribute('data-button-id');
  expect(otherTabId, 'a second selectable tab should exist').toBeTruthy();

  // Open a real Mission dialog through the notification cue (same
  // trigger dialog-lifecycle.spec uses — a raw DOM click on the board
  // card doesn't map to the render layer's custom `vclick`).
  await page.evaluate(() => {
    const groot = (window as unknown as DDWindow).__dd?._app?.game;
    if (!groot) throw new Error('game root not ready');
    const gestalt = Object.keys(groot.Missions?.Missions ?? {})[0];
    if (!gestalt) throw new Error('no missions defined in ruleset');
    if (groot.raw_data?.mission_briefings_seen) {
      delete groot.raw_data.mission_briefings_seen[gestalt];
    }
    groot.makeNotifications?.({ mission_active: gestalt });
  });

  await expect(page.locator('.PopupContainer.lockOn.Mission')).toBeVisible({ timeout: 5_000 });
  await expect(page.locator('.PopupBody.MissionBody')).toBeVisible();

  const dimmed = await page.evaluate(() => {
    const menu = document.querySelector<HTMLElement>('.MainMenu');
    return {
      hasClass: !!menu?.classList.contains('DialogLock'),
      filter: menu ? getComputedStyle(menu).filter : null,
    };
  });
  expect(dimmed.hasClass, '.MainMenu gets .DialogLock while a dialog is open').toBe(true);
  expect(dimmed.filter, '.MainMenu is visibly darkened').not.toBe('none');

  // A click over a tab lands on the full-screen overlay covering the
  // header (not the tab itself), so it dismisses the dialog and does
  // NOT switch the view.  Click by coordinate — the tab is obscured by
  // the overlay, so a targeted `.click()` would fail the actionability
  // check.
  const tabBox = await otherTab.boundingBox();
  if (!tabBox) throw new Error('tab has no bounding box');
  await page.mouse.click(tabBox.x + tabBox.width / 2, tabBox.y + tabBox.height / 2);
  await expect(page.locator('.PopupBody.MissionBody')).toHaveCount(0);
  expect(
    await page.locator('.mm-tab.active').first().getAttribute('data-button-id'),
    'tab switch was suppressed — still on the original view'
  ).toBe(activeTabId);

  // Header is functional again: the lock is cleared and the same tab
  // now actually switches the view.
  await expect(page.locator('.MainMenu.DialogLock')).toHaveCount(0);
  await page.locator(`.mm-tab[data-button-id="${otherTabId}"]`).click();
  await expect(page.locator(`.mm-tab.active[data-button-id="${otherTabId}"]`)).toBeVisible();
});
