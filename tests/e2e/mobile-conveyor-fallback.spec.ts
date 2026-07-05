/**
 * Mobile conveyor scale (issue: "band too long on Android WebView /
 * Firefox → Ausbauen button off-screen", then follow-up: "band much
 * smaller and not centred on Firefox").
 *
 * The mobile conveyor shrinks the fixed 520-px belt box with
 * `transform: scale(<ratio>)` so it fills the viewport width.  Computing a
 * *responsive* ratio in CSS needs `length / length` calc division
 * (`(100vw - 24px) / 520px`), which Firefox and older Android WebView
 * reject.  Behind a `var()` that produced `transform: none` (band
 * overflowed, button off-screen); with a plain static fallback the band
 * rendered too small and hugged the left edge.  So the responsive ratio is
 * now computed in JS (RenderDBQueue.fitMobileConveyor) and written inline,
 * which works on every engine.
 *
 * This spec (Chromium-only in CI, but the JS path is engine-independent)
 * guards that on a narrow viewport the belt is scaled to *fill* the width
 * — i.e. its visual width ≈ viewport − side gutters — so it stays centred
 * and the pipe/button stay on screen.  The static-fallback and
 * no-fragile-calc guarantees are asserted at the source level in
 * tests/render/conveyor-scale-fallback.test.js.
 */

import { expect, test } from '@playwright/test';

// 360 px is a common Android WebView CSS width — one of the engines the
// original bug reproduced on.
test.use({ viewport: { width: 360, height: 800 } });

test('conveyor scale: belt fills the viewport width and the button stays on screen', async ({
  page,
}) => {
  await page.goto('/?devtools=1');
  await expect(page.locator('[data-testid="game-container"]')).toBeVisible({
    timeout: 50_000,
  });
  await page.locator('.mm-tab[data-button-id="Database"]').dispatchEvent('click');
  await page.waitForTimeout(800);

  const info = await page.evaluate(() => {
    const conv = document.querySelector<HTMLElement>('.DatabaseQueueConveyor');
    const pipe = document.querySelector<HTMLElement>('.DatabaseQueuePipe');
    if (!conv) return null;
    const t = getComputedStyle(conv).transform;
    const r = conv.getBoundingClientRect();
    const p = pipe?.getBoundingClientRect();
    return {
      transform: t,
      convLeft: r.left,
      convRight: r.right,
      convWidth: r.width,
      pipeRight: p?.right,
      vw: window.innerWidth,
    };
  });
  expect(info).not.toBeNull();
  if (!info) return;

  // The original symptom was `transform: none` (no scale → full-width band).
  expect(info.transform, 'conveyor should be scaled, not left at none').not.toBe('none');

  // The belt should fill the viewport width minus the 12-px side gutters:
  // visual width = 520 × scale, and scale = (vw - 24) / 520, so the visual
  // width lands at ~vw - 24.  This catches the "too small / left-hugged"
  // regression where the belt collapsed to the static fallback (286 px).
  const expectedWidth = Math.min(520, info.vw - 24); // 360 → 336
  expect(info.convWidth).toBeGreaterThan(expectedWidth - 6);
  expect(info.convWidth).toBeLessThanOrEqual(expectedWidth + 6);

  // ...and it stays within the viewport (left gutter ≥ 0, right ≤ vw).
  expect(info.convLeft).toBeGreaterThanOrEqual(0);
  expect(info.convRight).toBeLessThanOrEqual(info.vw);
  if (info.pipeRight !== undefined) {
    expect(info.pipeRight).toBeLessThanOrEqual(info.vw);
  }
});
