/**
 * Conveyor scale fallback (issue: "band too long on Android WebView /
 * Firefox, Ausbauen button pushed off-screen").
 *
 * The mobile conveyor shrinks the fixed 520-px belt box with
 * `transform: scale(<ratio>)`.  The ratio used to be computed as
 * `clamp(0.4, calc((100vw - 24px) / 520px), 1)` and consumed through a
 * custom property: `transform: scale(var(--conv-s))`.
 *
 * `length / length` division in calc() (the bit that turns two lengths
 * into the unitless scalar scale() needs) only landed in Chrome 91,
 * Safari 16.4 and Firefox 116.  Engines without it (older Android
 * WebView / Gecko) couldn't compute the ratio.  Because the value was
 * behind `var()`, the declaration parsed fine and only failed at
 * computed-value time, so `transform` fell back to its initial `none` —
 * no scale at all.  The 520-px band then overflowed the viewport and the
 * pipe (with the "Ausbauen"/Upgrade button at `right: 0`) ended up off
 * screen.  Chrome desktop, Electron and iOS WebKit all support the
 * division, which is why it only broke on the other engines.
 *
 * The fix inlines the calc (so unsupported engines drop the declaration
 * at parse time and cascade back to a real value) and prepends a static
 * `transform: scale()` fallback.  The source-ordering half of the fix is
 * asserted in tests/render/conveyor-scale-fallback.test.js (Chromium's
 * CSSOM de-duplicates the two same-block `transform` declarations, so the
 * fallback isn't observable here).  This spec guards the user-visible
 * symptom on a narrow viewport.
 */

import { expect, test } from '@playwright/test';

// 360 px is a common Android WebView CSS width — one of the engines the
// original bug reproduced on.
test.use({ viewport: { width: 360, height: 800 } });

test('conveyor scale: a real scale is applied (not none) and the button stays on screen', async ({
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
    return { transform: t, convRight: r.right, pipeRight: p?.right, vw: window.innerWidth };
  });
  expect(info).not.toBeNull();
  if (!info) return;

  // The symptom was `transform: none` (no scale → full-width band).
  expect(info.transform, 'conveyor should be scaled, not left at none').not.toBe('none');

  // The pipe (and the Upgrade button anchored to its right edge) must stay
  // inside the viewport.
  if (info.pipeRight !== undefined) {
    expect(info.pipeRight).toBeLessThanOrEqual(info.vw);
  }
  expect(info.convRight).toBeLessThanOrEqual(info.vw);
});
