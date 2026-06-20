/**
 * Leaderboard tab visibility and rendering test
 *
 * Validates that clicking the LEADERBOARD button in the main menu shows
 * the topscores view without errors.
 */

import { expect, test } from '@playwright/test';

const GAME_CONTAINER = '[data-testid="game-container"]';

test('leaderboard tab: LEADERBOARD button appears in main menu', async ({ page }) => {
  const jsErrors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error' && !msg.text().includes('favicon')) {
      jsErrors.push(msg.text());
    }
  });
  page.on('pageerror', (err) => {
    jsErrors.push(err.message);
  });

  await page.goto('/?devtools=1');

  await expect(page.locator(GAME_CONTAINER)).toBeVisible({
    timeout: 50_000,
  });

  // Dismiss the language picker — it intercepts clicks on the menu buttons below it.
  // Picking EN persists the locale and reloads the page.
  const langOverlay = page.locator('.LangSelectOverlay');
  if (await langOverlay.isVisible().catch(() => false)) {
    await langOverlay.locator('.lang-pick[data-locale="en"]').click();
    await expect(page.locator(GAME_CONTAINER)).toBeVisible({
      timeout: 50_000,
    });
  }

  const leaderboardButton = page
    .locator('.mm-tab')
    .filter({ hasText: /Leaderboard/ })
    .first();

  await expect(leaderboardButton).toBeVisible();

  await leaderboardButton.click();

  const topscoresView = page.locator('.TopscorePerp').first();
  await expect(topscoresView).toBeVisible({ timeout: 10_000 });

  expect(jsErrors, `JS errors opening Leaderboard tab: ${jsErrors.join(' | ')}`).toHaveLength(0);
});
