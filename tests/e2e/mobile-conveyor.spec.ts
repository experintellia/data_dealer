/**
 * Conveyor anchoring (issue #80 follow-up).
 *
 * After the user reported the conveyor was clipped on the right and the
 * "pipe" sprite ended up on the wrong side, we anchored `.DatabaseQueue`
 * (the conveyor's parent) to the visible Stage via CSS overrides at
 * ≤ 926 px instead of letting the JS-computed translate place it
 * relative to the legacy 720-px design centre.
 *
 * This spec asserts:
 *   - `.DatabaseQueue` sits inside the visible viewport (left ≥ 0,
 *     right ≤ vw) at 390 px wide
 *   - the conveyor's right edge (where the pipe lives) is also inside
 *     the viewport
 *   - the zoom controls aren't covered by the conveyor (their bottom is
 *     above the conveyor's top)
 */

import { expect, test } from '@playwright/test';

test.use({ viewport: { width: 390, height: 844 } });

test('conveyor: parent anchored inside viewport, right edge visible', async ({ page }) => {
  await page.goto('/?devtools=1');
  await expect(page.locator('[data-testid="game-container"]')).toBeVisible({
    timeout: 50_000,
  });
  await page.locator('.MainMenuButton[data-button-id="Database"]').dispatchEvent('click');
  await page.waitForTimeout(800);

  const layout = await page.evaluate(() => {
    const dbq = document.querySelector<HTMLElement>('.DatabaseQueue');
    const conv = document.querySelector<HTMLElement>('.DatabaseQueueConveyor');
    if (!dbq || !conv) return null;
    const a = dbq.getBoundingClientRect();
    const b = conv.getBoundingClientRect();
    return {
      dbq: { l: a.left, r: a.right, w: a.width },
      conv: { l: b.left, r: b.right, w: b.width },
      vw: window.innerWidth,
    };
  });
  expect(layout).not.toBeNull();
  if (!layout) return;
  // The DatabaseQueue parent sits inside the viewport (with the 12 px
  // side padding from the override).
  expect(layout.dbq.l).toBeGreaterThanOrEqual(11);
  expect(layout.dbq.r).toBeLessThanOrEqual(layout.vw - 11);
  // The conveyor itself fits inside its parent (visual width is parent
  // width × the scaled factor, capped at parent width).
  expect(layout.conv.l).toBeGreaterThanOrEqual(layout.dbq.l - 1);
  expect(layout.conv.r).toBeLessThanOrEqual(layout.vw - 1);
});

test('conveyor: anchored to the bottom of the visible viewport', async ({ page }) => {
  await page.goto('/?devtools=1');
  await expect(page.locator('[data-testid="game-container"]')).toBeVisible({
    timeout: 50_000,
  });
  await page.locator('.MainMenuButton[data-button-id="Database"]').dispatchEvent('click');
  await page.waitForTimeout(800);

  const layout = await page.evaluate(() => {
    const conv = document.querySelector<HTMLElement>('.DatabaseQueueConveyor');
    if (!conv) return null;
    const r = conv.getBoundingClientRect();
    return { convBottom: r.bottom, vh: window.innerHeight };
  });
  expect(layout).not.toBeNull();
  if (!layout) return;
  // Conveyor visual bottom should sit ~12 px above the viewport bottom
  // (the gutter we explicitly reserve via `.DatabaseQueue { bottom: 12 }`).
  const gap = layout.vh - layout.convBottom;
  expect(gap).toBeGreaterThanOrEqual(0);
  expect(gap).toBeLessThanOrEqual(40);
});

test('conveyor: PipeBack paints behind the belt sprite (not on top)', async ({ page }) => {
  await page.goto('/?devtools=1');
  await expect(page.locator('[data-testid="game-container"]')).toBeVisible({
    timeout: 50_000,
  });
  await page.locator('.MainMenuButton[data-button-id="Database"]').dispatchEvent('click');
  await page.waitForTimeout(800);

  const layout = await page.evaluate(() => {
    const conv = document.querySelector<HTMLElement>('.DatabaseQueueConveyor');
    const back = document.querySelector<HTMLElement>('.DatabaseQueuePipeBack');
    if (!conv || !back) return null;
    const cs = getComputedStyle(conv);
    return {
      pipeBackZ: Number.parseInt(getComputedStyle(back).zIndex, 10),
      // Mobile rule moves the belt sprite from `.DatabaseQueueConveyor
      // { background }` to a `::before` pseudo-element so it can paint
      // ABOVE PipeBack (which is at z-index:-1) inside the transform-
      // induced stacking context.  Verify the conveyor's own bg is
      // empty (the fix is in place).
      conveyorBg: cs.backgroundImage,
    };
  });
  expect(layout).not.toBeNull();
  if (!layout) return;
  // PipeBack stays at the desktop value of -1 — its painting order is
  // controlled by being a sibling of the ::before belt pseudo-element.
  expect(layout.pipeBackZ).toBeLessThan(0);
  expect(layout.conveyorBg, 'belt bg should have moved off the conveyor').toBe('none');
});

test('zoom controls: float above the conveyor (not covered)', async ({ page }) => {
  await page.goto('/?devtools=1');
  await expect(page.locator('[data-testid="game-container"]')).toBeVisible({
    timeout: 50_000,
  });
  await page.locator('.MainMenuButton[data-button-id="Database"]').dispatchEvent('click');
  await page.waitForTimeout(800);

  const layout = await page.evaluate(() => {
    const zoom = document.querySelector<HTMLElement>('.ZoomControls');
    const conv = document.querySelector<HTMLElement>('.DatabaseQueueConveyor');
    if (!zoom || !conv) return null;
    const z = zoom.getBoundingClientRect();
    const c = conv.getBoundingClientRect();
    return {
      zoomBottom: z.bottom,
      zoomTop: z.top,
      convTop: c.top,
      convBottom: c.bottom,
    };
  });
  expect(layout).not.toBeNull();
  if (!layout) return;
  // Zoom bottom edge sits above the conveyor's top (with some slack so
  // a single-pixel overlap doesn't fail the assertion).
  expect(layout.zoomBottom, JSON.stringify(layout)).toBeLessThanOrEqual(layout.convTop + 4);
});
