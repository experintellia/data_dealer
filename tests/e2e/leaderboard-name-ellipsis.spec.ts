/**
 * Leaderboard long-name overflow regression test.
 *
 * A peer whose display_name is far wider than the row used to wrap onto a
 * second line, overflowing the fixed 32px row height and overlapping the row
 * below. The fix constrains `.TopscoreDisplayname` to a single line with an
 * ellipsis (overflow:hidden + text-overflow:ellipsis + white-space:nowrap).
 *
 * This test seeds one peer with a very long name and asserts that:
 *   1. the name is truncated (rendered width < intrinsic text width), and
 *   2. the row keeps its single-line height, so it can't overlap neighbours.
 */

import { expect, test } from '@playwright/test';

type PeerSeed = {
  display_name: string;
  cash: number;
  profiles: number;
  xp: number;
  level: number;
  spent: number;
  last_seen_ts: number;
  last_seen_serial: null;
};

function mkPeer(p: Partial<PeerSeed> & { display_name: string }): PeerSeed {
  return {
    cash: 0,
    profiles: 0,
    xp: 0,
    level: 1,
    spent: 0,
    last_seen_ts: 0,
    last_seen_serial: null,
    ...p,
  };
}

const LONG_NAME = 'Maximiliana-Wilhelmina von und zu Habsburg-Lothringen the Third';

test('leaderboard: an overlong display name truncates with an ellipsis instead of wrapping', async ({
  page,
}) => {
  await page.goto('/?devtools=1');
  await expect(page.locator('[data-testid="game-container"]')).toBeVisible({ timeout: 50_000 });

  const SELF = 'alice@local';
  await page.evaluate(
    async ({ peers, selfAddr }) => {
      const boot = await new Promise<any>((res, rej) =>
        (window as any).require(['boot'], res, rej)
      );
      const app = (window as any).require('app').getApplication();
      boot.setState(Object.assign({}, boot.getState(), { addr: selfAddr, peers }));
      await Promise.resolve();
      await new Promise((r) => setTimeout(r, 50));
      app.game.Topscores.updateScores();
      app.game.Topscores.trigger('button_click.ViewTabMenuButton', ['cash']);
      await Promise.resolve();
      await new Promise((r) => setTimeout(r, 50));
    },
    {
      peers: {
        [SELF]: mkPeer({ display_name: LONG_NAME, cash: 9_999_999, last_seen_ts: Date.now() }),
        'bob@test': mkPeer({ display_name: 'Bob', cash: 250_000, last_seen_ts: Date.now() }),
      },
      selfAddr: SELF,
    }
  );

  // Open the Leaderboard tab in the UI so the row is actually laid out —
  // hidden renderNodes report 0 width and can't demonstrate overflow.
  await page
    .locator('.mm-tab')
    .filter({ hasText: /Leaderboard/ })
    .first()
    .click();

  const row = page.locator('[data-testid="dd-leaderboard-row-alice@local"]:visible').first();
  await expect(row).toBeVisible({ timeout: 10_000 });
  const name = row.locator('.TopscoreDisplayname');

  // The full name text is present in the DOM (only visually clipped).
  await expect(name).toHaveText(LONG_NAME);

  // CSS contract: single-line ellipsis truncation.
  await expect(name).toHaveCSS('text-overflow', 'ellipsis');
  await expect(name).toHaveCSS('white-space', 'nowrap');
  await expect(name).toHaveCSS('overflow-x', 'hidden');

  // The element is actually overflowing — its content is wider than the box,
  // which is what makes the ellipsis appear.
  const overflow = await name.evaluate(
    (el) => (el as HTMLElement).scrollWidth - (el as HTMLElement).clientWidth
  );
  expect(overflow).toBeGreaterThan(0);

  // The name stays on a single line, so the row keeps its design height and
  // cannot overlap the row below it.
  const lineHeight = await name.evaluate((el) =>
    Number.parseFloat(getComputedStyle(el as HTMLElement).lineHeight)
  );
  const boxHeight = await name.evaluate((el) => (el as HTMLElement).clientHeight);
  expect(boxHeight).toBeLessThanOrEqual(lineHeight + 1);
});
