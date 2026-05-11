/**
 * High score tab visibility and rendering test
 *
 * Validates that clicking the HIGHSCORE button in the main menu shows
 * the topscores view without errors.
 */

import { expect, test } from '@playwright/test';

test('highscore tab: HIGHSCORE button appears in main menu', async ({ page }) => {
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

  // Wait for game to load
  await expect(page.locator('[data-testid="game-container"]')).toBeVisible({
    timeout: 50_000,
  });

  // Dismiss the language picker if it appears — it intercepts clicks on the
  // menu buttons below it. Picking EN persists the locale and reloads the page.
  const langOverlay = page.locator('.LangSelectOverlay');
  if (await langOverlay.isVisible().catch(() => false)) {
    await langOverlay.locator('.lang-pick[data-locale="en"]').click();
    await expect(page.locator('[data-testid="game-container"]')).toBeVisible({
      timeout: 50_000,
    });
  }

  // Check that Highscore button exists by looking for mm-tab (translated to "Highscore" in German)
  const highscoreButton = page
    .locator('.mm-tab')
    .filter({ hasText: /Highscore/ })
    .first();

  await expect(highscoreButton).toBeVisible();

  // Click the Highscore button
  await highscoreButton.click();

  // Wait for topscores view to appear
  await page.waitForTimeout(500);

  // Check for JS errors
  expect(jsErrors, `JS errors when opening Highscore tab: ${jsErrors.join(' | ')}`).toHaveLength(0);

  // Verify topscores view is now visible (should have TopscorePerp elements)
  const topscoresView = page.locator('.TopscorePerp').first();
  await expect(topscoresView).toBeVisible();
});
