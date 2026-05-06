/**
 * Iter-2 mobile-layout regressions covered by user feedback (issue #80):
 *   - all 4 main-menu tabs sit on a single row at 390 px
 *   - the cloned XP bar in MainMenu fires a click_status.XP event when
 *     tapped (the original star bar in the in-stage Statusbar is hidden
 *     on mobile, so the menu copy is the only entry point)
 *   - the username label sits above the XP bar
 *   - statusbar items (Profiles/Cash/AP/Karma) sit in a 2×2 grid
 *     (Profiles | Karma on row 1, Cash | AP on row 2) within the
 *     viewport, no horizontal clipping
 */

import { expect, test } from '@playwright/test';

test.use({ viewport: { width: 390, height: 844 } });

test('iter2: all 4 tabs on one row', async ({ page }) => {
  await page.goto('/?devtools=1');
  await expect(page.locator('[data-testid="game-container"]')).toBeVisible({
    timeout: 50_000,
  });

  // Group tops into row-bands.  The desktop active-tab CSS bumps the
  // active button by 4 px (top:9 vs top:13), so we bucket by 10-px bands
  // to recognise that the active tab still sits visually in row 1.
  const rows = await page.locator('.MainMenu .MainMenuButton').evaluateAll((els) => {
    const tops = els.map((e) => Math.round(e.getBoundingClientRect().top));
    const bands: number[] = [];
    for (const t of tops) {
      const existing = bands.find((b) => Math.abs(b - t) <= 10);
      if (existing === undefined) bands.push(t);
    }
    return bands;
  });
  expect(rows.length, `tabs span ${rows.length} row-bands: ${rows.join(',')}`).toBe(1);

  const count = await page.locator('.MainMenu .MainMenuButton').count();
  expect(count).toBe(4);
});

test('iter2: cloned XP bar is clickable + emits click_status.XP', async ({ page }) => {
  await page.goto('/?devtools=1');
  await expect(page.locator('[data-testid="game-container"]')).toBeVisible({
    timeout: 50_000,
  });

  // Wire a one-shot listener on the GameRoot so we can detect the event.
  const fired = await page.evaluate(async () => {
    const w: any = window;
    const appMod = await new Promise<any>((res, rej) => w.require(['app'], res, rej));
    const game = appMod.getApplication().game;
    let saw = false;
    game.on('click_status.XP', () => {
      saw = true;
    });
    const xpItem = document.querySelector<HTMLElement>('.MainMenuXP .StatusItem.XP');
    if (!xpItem) throw new Error('cloned XP item not found');
    xpItem.dispatchEvent(
      new TouchEvent('touchstart', { bubbles: true, cancelable: true, touches: [] as any })
    );
    xpItem.dispatchEvent(
      new TouchEvent('touchend', { bubbles: true, cancelable: true, touches: [] as any })
    );
    return saw;
  });
  expect(fired).toBe(true);
});

test('iter2: username label sits above the cloned XP bar', async ({ page }) => {
  await page.goto('/?devtools=1');
  await expect(page.locator('[data-testid="game-container"]')).toBeVisible({
    timeout: 50_000,
  });

  const layout = await page.evaluate(() => {
    const name = document.querySelector<HTMLElement>('.MainMenuXP .MainMenuXPName');
    const bar = document.querySelector<HTMLElement>('.MainMenuXP .StatusItem.XP');
    if (!name || !bar) return null;
    return {
      nameBottom: name.getBoundingClientRect().bottom,
      barTop: bar.getBoundingClientRect().top,
      nameFont: Number.parseFloat(getComputedStyle(name).fontSize),
    };
  });
  expect(layout).not.toBeNull();
  if (!layout) return;
  // Name's baseline ends above (or just at) the XP bar's top edge,
  // with a small tolerance for the user's manual `margin-bottom: -1px`
  // tweak that makes the label hug the bar visually.
  expect(layout.nameBottom).toBeLessThanOrEqual(layout.barTop + 4);
  // Smaller font than the bar (≤ 14 px is "small label" territory).
  expect(layout.nameFont).toBeLessThanOrEqual(14);
});

test('iter2: 4 statusbar items form a 2×2 grid inside the viewport', async ({ page }) => {
  await page.goto('/?devtools=1');
  await expect(page.locator('[data-testid="game-container"]')).toBeVisible({
    timeout: 50_000,
  });

  const layout = await page.evaluate(() => {
    const sel = (id: string) =>
      document.querySelector<HTMLElement>(`.Statusbar .StatusItem[data-status-id="${id}"]`);
    const profiles = sel('Profiles');
    const cash = sel('Cash');
    const ap = sel('AP');
    const karma = sel('karma');
    if (!profiles || !cash || !ap || !karma) return null;
    const rect = (el: HTMLElement) => el.getBoundingClientRect();
    // Bucket tops/lefts into 4-px bands so sub-pixel rounding doesn't
    // split a row/column into two.
    const bucket = (xs: number[]) => {
      const bands: number[] = [];
      for (const x of xs) {
        if (!bands.some((b) => Math.abs(b - x) <= 4)) bands.push(x);
      }
      return bands.length;
    };
    const items = [profiles, cash, ap, karma];
    const tops = items.map((e) => rect(e).top);
    const lefts = items.map((e) => rect(e).left);
    const rights = items.map((e) => rect(e).right);
    return {
      uniqueRows: bucket(tops),
      uniqueCols: bucket(lefts),
      itemCount: items.length,
      maxRight: Math.max(...rights),
      minLeft: Math.min(...lefts),
      vw: window.innerWidth,
      profilesTop: rect(profiles).top,
      karmaTop: rect(karma).top,
      cashTop: rect(cash).top,
      apTop: rect(ap).top,
      profilesLeft: rect(profiles).left,
      karmaLeft: rect(karma).left,
      cashLeft: rect(cash).left,
      apLeft: rect(ap).left,
    };
  });
  expect(layout).not.toBeNull();
  if (!layout) return;
  expect(layout.itemCount).toBe(4);
  expect(layout.uniqueRows, 'status items span 2 rows').toBe(2);
  expect(layout.uniqueCols, 'status items span 2 columns').toBe(2);
  expect(layout.maxRight).toBeLessThanOrEqual(layout.vw + 1);
  expect(layout.minLeft).toBeGreaterThanOrEqual(-1);

  // Row 1: Profiles + Karma share a top edge (within 4 px); Row 2:
  // Cash + AP share a top edge below row 1.
  expect(Math.abs(layout.profilesTop - layout.karmaTop)).toBeLessThanOrEqual(4);
  expect(Math.abs(layout.cashTop - layout.apTop)).toBeLessThanOrEqual(4);
  expect(layout.cashTop).toBeGreaterThan(layout.profilesTop + 4);

  // Col 1: Profiles + Cash share a left edge; Col 2: Karma + AP share
  // a left edge to the right of col 1.
  expect(Math.abs(layout.profilesLeft - layout.cashLeft)).toBeLessThanOrEqual(4);
  expect(Math.abs(layout.karmaLeft - layout.apLeft)).toBeLessThanOrEqual(4);
  expect(layout.karmaLeft).toBeGreaterThan(layout.profilesLeft + 4);
});
