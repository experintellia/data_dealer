/**
 * `attachDragScroll` (PopupMenu tab strip, AboutPopup) arms drag mode
 * after 4px of pointer travel and then swallows the click.  On a strip
 * that fits (nothing to scroll) a slightly wobbly click must still
 * switch the tab.
 */

import { expect, test } from '@playwright/test';
import { bootGame } from './_helpers';

test('popup tab strip: a click with 6px of wobble still switches tab', async ({ page }) => {
  await bootGame(page);
  await page.evaluate(async () => {
    const w = window as any;
    const boot = await new Promise<any>((res, rej) => w.require(['boot'], res, rej));
    const st = boot.getState();
    boot.setState({
      ...st,
      game_values: { ...st.game_values, cash_value: 1000, xp_level: 2, xp_value: 20 },
    });
    const eng = await new Promise<any>((res, rej) => w.require(['LocalEngine'], res, rej));
    await eng.buyPerp('Imperium', 'project001');
    await w.__ddSettle?.((s: any) =>
      (s.nodes ?? []).some((n: any) => n.full_path === 'Imperium.project001')
    );
  });
  await page.reload();
  await bootGame(page);
  await page.evaluate(() => {
    const gnode = (window as any).__dd._app.game.getById('project001');
    gnode.openPopup();
    // Powerup tabs render once fetched (see dialog-lifecycle BuySlots test).
    gnode.fetchPowerups(() => {
      gnode.compilePowerups();
      gnode.compileProfileSet?.();
      if (gnode.renderPopup) gnode.updatePopup();
    });
  });

  const strip = page.locator('.PopupContainer.lockOn .PopupMenu');
  await expect(strip).toBeVisible();
  // Precondition: the strip fits, so there is nothing to drag-scroll.
  expect(await strip.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);

  const tab = strip.locator('.PopupMenuButton[data-tab="UpgradePowerup"]');
  await expect(tab).not.toHaveClass(/active/);
  const box = await tab.boundingBox();
  if (!box) throw new Error('tab has no box');
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 6, y, { steps: 3 });
  await page.mouse.up();

  await expect(tab).toHaveClass(/active/);
});
