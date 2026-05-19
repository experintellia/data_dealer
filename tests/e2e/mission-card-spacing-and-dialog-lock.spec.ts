/**
 * Two follow-up fixes on the mission-card Preact port (PR #312):
 *
 *  1. Spacing regression — the legacy `mission_goal_small.html` loop
 *     emitted newlines between the inline-block `.MissionGoal.small`
 *     pills and leaned on the resulting whitespace gap.  The Preact
 *     card renders adjacent siblings with no whitespace, so the pills
 *     became flush.  Fixed with an explicit `.MissionGoal.small`
 *     margin (css/Render.css) — guarded here so it can't silently
 *     regress back to whitespace-dependent spacing.
 *
 *  2. Dialog modality — the dialog backdrop only covers the game
 *     `.Stage`; the `.MainMenu` game-tab nav is a sibling above it, so
 *     tabs were clickable from under an open dialog.  `dialogManager`
 *     now marks `#GameContainer.DialogLock`; CSS makes the menu
 *     non-interactive while a dialog is open.
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
  await page.waitForTimeout(800);

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

test('an open dialog locks the game-tab nav until dismissed', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 800 });
  await bootGame(page);

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

  const locked = await page.evaluate(() => {
    const root = document.querySelector('#GameContainer');
    const menu = document.querySelector<HTMLElement>('.MainMenu');
    return {
      hasClass: !!root?.classList.contains('DialogLock'),
      pointerEvents: menu ? getComputedStyle(menu).pointerEvents : null,
    };
  });
  expect(locked.hasClass, '#GameContainer gets .DialogLock while a dialog is open').toBe(true);
  expect(locked.pointerEvents, '.MainMenu is non-interactive while locked').toBe('none');

  await page.locator('.PopupContainer.lockOn .PopupClose').first().click();
  await expect(page.locator('.PopupBody.MissionBody')).toHaveCount(0);

  const unlocked = await page.evaluate(() => {
    const root = document.querySelector('#GameContainer');
    const menu = document.querySelector<HTMLElement>('.MainMenu');
    return {
      hasClass: !!root?.classList.contains('DialogLock'),
      pointerEvents: menu ? getComputedStyle(menu).pointerEvents : null,
    };
  });
  expect(unlocked.hasClass, '.DialogLock cleared on close').toBe(false);
  expect(unlocked.pointerEvents, '.MainMenu interactive again after close').not.toBe('none');
});
