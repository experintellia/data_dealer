/**
 * Energy refill timer visibility tests.
 *
 * Covers two new UX improvements:
 *
 * 1. **Always-visible timer when AP is 0** — when the player has no energy,
 *    the "More Energy in MM:SS" countdown inside `.StatusRemain` must be
 *    shown on the statusbar without any hover interaction (mobile has no hover).
 *    Conversely, when AP is full the tooltip must stay hidden until hover.
 *
 * 2. **Refill timer inside the AP info dialog** — when the player opens the
 *    Energy status popup while AP < max, the dialog must contain the refill
 *    countdown text so mobile users who tap the icon to learn more can see
 *    when their energy will come back.
 */

import { expect, test } from '@playwright/test';
import { bootGame } from './_helpers';

// ── Test 1: statusbar always shows the timer when AP is 0 ─────────────────

test('energy refill timer: visible on statusbar without hover when AP is 0', async ({ page }) => {
  await page.goto('/?devtools=1');
  await expect(page.locator('[data-testid="game-container"]')).toBeVisible({ timeout: 50_000 });
  await expect(page.locator('[data-testid="dd-ap-counter"]')).toBeVisible();

  // Read max from engine so the test works regardless of game config.
  const { ap_max } = await page.evaluate(async () => {
    const boot = await new Promise<any>((res, rej) => (window as any).require(['boot'], res, rej));
    const gv = boot.getState().game_values;
    return { ap_max: gv.ap_max as number };
  });
  expect(ap_max).toBeGreaterThan(0);

  // At full AP the refill tooltip must be hidden (no hover has occurred).
  await expect(page.locator('[data-testid="dd-ap-value"]')).toHaveText(`${ap_max}/${ap_max}`, {
    timeout: 2_000,
  });
  await expect(page.locator('[data-testid="dd-ap-remain"]')).not.toBeVisible();

  // Drive AP to 0 via a silent updateGameValues (mirrors what the server
  // sends after a charge action drains the last point).
  await page.evaluate(() => {
    const appModule: any = (window as any).require('app');
    const game: any = appModule?.getApplication?.()?.game;
    if (!game) throw new Error('game layer not initialised');
    game.updateGameValues({ ap_snapshot: 0 }, false, undefined, true);
  });

  // The countdown must become visible automatically — no hover required.
  await expect(page.locator('[data-testid="dd-ap-remain"]')).toBeVisible({ timeout: 2_000 });

  // The text must include the localised "Energy in" prefix and a MM:SS timer.
  const remainText = await page.locator('[data-testid="dd-ap-remain"]').innerText();
  expect(remainText).toMatch(/Energy in/i);
  expect(remainText).toMatch(/\d{2}:\d{2}/); // MM:SS (or HH:MM:SS)
});

test('energy refill timer: hidden again once AP is restored to full', async ({ page }) => {
  await page.goto('/?devtools=1');
  await expect(page.locator('[data-testid="game-container"]')).toBeVisible({ timeout: 50_000 });

  const { ap_max } = await page.evaluate(async () => {
    const boot = await new Promise<any>((res, rej) => (window as any).require(['boot'], res, rej));
    const gv = boot.getState().game_values;
    return { ap_max: gv.ap_max as number };
  });

  // Set AP to 0 so the timer appears.
  await page.evaluate(() => {
    const appModule: any = (window as any).require('app');
    const game: any = appModule?.getApplication?.()?.game;
    if (!game) throw new Error('game layer not initialised');
    game.updateGameValues({ ap_snapshot: 0 }, false, undefined, true);
  });
  await expect(page.locator('[data-testid="dd-ap-remain"]')).toBeVisible({ timeout: 2_000 });

  // Restore AP to full — timer should disappear.
  await page.evaluate((max) => {
    const appModule: any = (window as any).require('app');
    const game: any = appModule?.getApplication?.()?.game;
    if (!game) throw new Error('game layer not initialised');
    game.updateGameValues({ ap_snapshot: max }, false, undefined, true);
  }, ap_max);
  await expect(page.locator('[data-testid="dd-ap-remain"]')).not.toBeVisible({ timeout: 2_000 });
});

// ── Test 2: AP info dialog shows refill time when AP < max ────────────────

test('energy dialog: shows refill countdown when AP is not full', async ({ page }) => {
  await bootGame(page);

  const { ap_max } = await page.evaluate(async () => {
    const boot = await new Promise<any>((res, rej) => (window as any).require(['boot'], res, rej));
    const gv = boot.getState().game_values;
    return { ap_max: gv.ap_max as number };
  });

  // Put AP one below max so apRemaining is computed by GameRoot.
  await page.evaluate((max) => {
    const appModule: any = (window as any).require('app');
    const game: any = appModule?.getApplication?.()?.game;
    if (!game) throw new Error('game layer not initialised');
    game.updateGameValues({ ap_snapshot: max - 1 }, false, undefined, true);
  }, ap_max);

  // Open the AP status dialog the same way the statusbar click handler does.
  await page.evaluate(() => {
    const groot = (window as any).__dd?._app?.game;
    if (!groot) throw new Error('GameRoot not available');
    groot.trigger('click_status.AP');
  });
  await expect(page.locator('.PopupContainer.lockOn')).toBeVisible({ timeout: 2_000 });
  await expect(page.locator('.PopupBody.Status .MainSpritesPopup.AP')).toBeVisible();

  // The dialog must contain the refill line.
  const refillLine = page.locator('.PopupText.APRemain');
  await expect(refillLine).toBeVisible({ timeout: 2_000 });
  const refillText = await refillLine.innerText();
  expect(refillText).toMatch(/Energy in/i);
  expect(refillText).toMatch(/\d{2}:\d{2}/);

  // Close dialog.
  await page.locator('.PopupContainer.lockOn .PopupClose').first().click();
  await expect(page.locator('.PopupBody.Status')).toBeHidden({ timeout: 3_000 });
});

test('energy dialog: no refill line when AP is full', async ({ page }) => {
  await bootGame(page);

  // Default game starts with full AP — just open the dialog.
  await page.evaluate(() => {
    const groot = (window as any).__dd?._app?.game;
    if (!groot) throw new Error('GameRoot not available');
    groot.trigger('click_status.AP');
  });
  await expect(page.locator('.PopupContainer.lockOn')).toBeVisible({ timeout: 2_000 });
  await expect(page.locator('.PopupBody.Status .MainSpritesPopup.AP')).toBeVisible();

  // No refill line when energy is full.
  await expect(page.locator('.PopupText.APRemain')).not.toBeVisible();

  await page.locator('.PopupContainer.lockOn .PopupClose').first().click();
  await expect(page.locator('.PopupBody.Status')).toBeHidden({ timeout: 3_000 });
});
