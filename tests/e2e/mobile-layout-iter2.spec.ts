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
  const rows = await page.locator('.MainMenu .mm-tab').evaluateAll((els) => {
    const tops = els.map((e) => Math.round(e.getBoundingClientRect().top));
    const bands: number[] = [];
    for (const t of tops) {
      const existing = bands.find((b) => Math.abs(b - t) <= 10);
      if (existing === undefined) bands.push(t);
    }
    return bands;
  });
  expect(rows.length, `tabs span ${rows.length} row-bands: ${rows.join(',')}`).toBe(1);

  const count = await page.locator('.MainMenu .mm-tab').count();
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
    const xpItem = document.querySelector<HTMLElement>('.mm-xp .StatusItem.XP');
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
    const name = document.querySelector<HTMLElement>('.mm-xp .mm-xp-name');
    const bar = document.querySelector<HTMLElement>('.mm-xp .StatusItem.XP');
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

  const TOL = 4;
  const layout = await page.evaluate(() => {
    const rect = (id: string) => {
      const el = document.querySelector<HTMLElement>(
        `.Statusbar .StatusItem[data-status-id="${id}"]`
      );
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { top: r.top, left: r.left, right: r.right };
    };
    const profiles = rect('Profiles');
    const cash = rect('Cash');
    const ap = rect('AP');
    const karma = rect('karma');
    if (!profiles || !cash || !ap || !karma) return null;
    return {
      profiles,
      cash,
      ap,
      karma,
      maxRight: Math.max(profiles.right, cash.right, ap.right, karma.right),
      minLeft: Math.min(profiles.left, cash.left, ap.left, karma.left),
      vw: window.innerWidth,
    };
  });
  expect(layout).not.toBeNull();
  if (!layout) return;
  expect(layout.maxRight).toBeLessThanOrEqual(layout.vw + 1);
  expect(layout.minLeft).toBeGreaterThanOrEqual(-1);

  // Row 1: Profiles | Karma; Row 2: Cash | AP.
  expect(Math.abs(layout.profiles.top - layout.karma.top)).toBeLessThanOrEqual(TOL);
  expect(Math.abs(layout.cash.top - layout.ap.top)).toBeLessThanOrEqual(TOL);
  expect(layout.cash.top).toBeGreaterThan(layout.profiles.top + TOL);

  // Col 1: Profiles + Cash; Col 2: Karma + AP.
  expect(Math.abs(layout.profiles.left - layout.cash.left)).toBeLessThanOrEqual(TOL);
  expect(Math.abs(layout.karma.left - layout.ap.left)).toBeLessThanOrEqual(TOL);
  expect(layout.karma.left).toBeGreaterThan(layout.profiles.left + TOL);
});
