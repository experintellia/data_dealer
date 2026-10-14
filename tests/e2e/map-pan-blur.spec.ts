/**
 * Map mouse-pan must end when the release is missed.
 *
 * RenderViewMap only cleared its pan flag on a `mouseup`.  Alt-tabbing or
 * hiding the tab mid-drag (or releasing outside the window) swallows that
 * mouseup, so the map kept following the bare cursor afterwards.  A
 * mousemove with no button held now ends the pan instead.
 */

import { expect, test } from '@playwright/test';
import { bootGame } from './_helpers';

test('map stops panning after a drag loses its mouseup to a window blur', async ({ page }) => {
  await bootGame(page);

  const pan = (opts: { buttons: number; blur?: boolean }) =>
    page.evaluate(({ buttons, blur }) => {
      const vm = (window as any).__dd._app.game.activeView.renderNode;
      const s = vm.scroller;
      const before = { x: s.__scrollLeft, y: s.__scrollTop };
      document
        .querySelector('#Imperium')
        ?.dispatchEvent(
          new MouseEvent('mousedown', { bubbles: true, clientX: 400, clientY: 300, buttons: 1 })
        );
      if (blur) {
        // The release happens elsewhere: the page sees blur + tab hide,
        // never the mouseup.
        window.dispatchEvent(new Event('blur'));
        document.dispatchEvent(new Event('visibilitychange'));
      }
      for (let i = 1; i <= 10; i++) {
        window.dispatchEvent(
          new MouseEvent('mousemove', { clientX: 400 - i * 13, clientY: 300 - i * 9, buttons })
        );
      }
      const after = { x: s.__scrollLeft, y: s.__scrollTop };
      const stillDragging = vm.dragging;
      window.dispatchEvent(new MouseEvent('mouseup'));
      return { moved: after.x !== before.x || after.y !== before.y, stillDragging };
    }, opts);

  const missed = await pan({ buttons: 0, blur: true });
  expect(missed.moved, 'buttonless moves after the missed release pan the map').toBe(false);
  expect(missed.stillDragging).toBe(false);

  // A real held-button drag still pans.
  const held = await pan({ buttons: 1 });
  expect(held.moved).toBe(true);
});
