/**
 * Phase 6 — live Topscores leaderboard (issue #30).
 *
 * Validates two contracts that #29 + #30 jointly enable:
 *
 *   1. With state.peers populated, the Topscores tab renders one
 *      `dd-leaderboard-row-{addr}` row per peer with the correct value
 *      for the active tab type.
 *   2. Mutating state.peers fires the boot subscribePeersChanged signal,
 *      which causes the Topscores view to re-render without the user
 *      clicking refresh and without polling.
 *
 * Strategy
 * --------
 * The dev-mode webxdc shim doesn't expose a clean way to inject a foreign
 * peer's update history, so we drive the engine the same way share-merge
 * and gameplay specs do — through `boot.setState` + AMD `Game.Topscores`.
 * That path exercises every layer below the route-from-webxdc-listener
 * step (which is identical code: both call _notifyPeersChanged when
 * state.peers identity changes).
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

async function waitForGameReady(page: import('@playwright/test').Page) {
  await expect(page.locator('[data-testid="game-container"]')).toBeVisible({
    timeout: 50_000,
  });
}

// Seeds peers and forces a fresh render of every Topscore tab. Returns the
// list of rendered testids so the caller can sanity-check ordering.
async function seedAndRender(
  page: import('@playwright/test').Page,
  peers: Record<string, PeerSeed>,
  selfAddr: string
) {
  return await page.evaluate(
    async ({ peers, selfAddr }) => {
      const boot = await new Promise<any>((res, rej) =>
        (window as any).require(['boot'], res, rej)
      );
      const app = (window as any).require('app').getApplication();

      // Replace the peers object identity so subscribePeersChanged fires.
      const next = Object.assign({}, boot.getState(), {
        addr: selfAddr,
        peers: peers,
      });
      boot.setState(next);

      // Wait one microtask for fetchScore promises to resolve and render.
      await Promise.resolve();
      await new Promise((r) => setTimeout(r, 50));

      // The boot subscription drives refreshFromPeers on the visible tab
      // only — to make every tab render in this test, force a manual
      // updateScores so all four tabs paint regardless of visibility.
      app.game.Topscores.updateScores();
      await Promise.resolve();
      await new Promise((r) => setTimeout(r, 50));
    },
    { peers, selfAddr }
  );
}

test('topscores: renders one row per peer with addr-keyed testid', async ({ page }) => {
  await page.goto('/?devtools=1');
  await waitForGameReady(page);

  const SELF = 'alice@local';
  await seedAndRender(
    page,
    {
      [SELF]: mkPeer({
        display_name: 'Alice',
        cash: 100,
        xp: 50,
        profiles: 7,
        level: 2,
        spent: 30,
        last_seen_ts: Date.now(),
      }),
      'bob@test': mkPeer({
        display_name: 'Bob',
        cash: 250,
        xp: 200,
        profiles: 12,
        level: 4,
        spent: 80,
        last_seen_ts: Date.now(),
      }),
    },
    SELF
  );

  // The Topscores ViewTab isn't surfaced until the user clicks the main-menu
  // button, but the child Topscore renderNodes are constructed at loadGame
  // and live in the DOM (hidden via .hide()). toBeAttached suffices to prove
  // the rows render — visibility is a separate UI-routing concern.
  await expect(
    page.locator('[data-testid="dd-leaderboard-row-alice@local"]').first()
  ).toBeAttached();
  await expect(page.locator('[data-testid="dd-leaderboard-row-bob@test"]').first()).toBeAttached();

  // Self row is highlighted via the `.user` class (set when score.self===true).
  const aliceRow = page.locator('[data-testid="dd-leaderboard-row-alice@local"]').first();
  await expect(aliceRow).toHaveClass(/\buser\b/);

  // Display names render from the peer entry rather than falling back to addr.
  await expect(aliceRow.locator('.TopscoreDisplayname')).toHaveText('Alice');
  const bobRow = page.locator('[data-testid="dd-leaderboard-row-bob@test"]').first();
  await expect(bobRow.locator('.TopscoreDisplayname')).toHaveText('Bob');
});

test('topscores: a state.peers mutation refreshes the leaderboard without manual reload', async ({
  page,
}) => {
  await page.goto('/?devtools=1');
  await waitForGameReady(page);

  const SELF = 'alice@local';

  // Seed with one peer + show the cash tab so refreshFromPeers's "visible-tab
  // only" branch fires on the second mutation (proving the live-refresh path,
  // not the explicit updateScores fallback used in the first test).
  await seedAndRender(
    page,
    {
      [SELF]: mkPeer({
        display_name: 'Alice',
        cash: 100,
        last_seen_ts: Date.now(),
      }),
    },
    SELF
  );

  // Click the cash tab so that a Topscore renderNode is visible.
  await page.evaluate(() => {
    const app = (window as any).require('app').getApplication();
    app.game.Topscores.trigger('button_click.ViewTabMenuButton', ['cash']);
  });
  await page.waitForTimeout(50);

  await expect(
    page.locator('[data-testid="dd-leaderboard-row-alice@local"]').first()
  ).toBeAttached();

  // Now push a new peer through setState — boot's peers-changed subscription
  // must drive refreshFromPeers, which re-renders the visible cash tab.
  await page.evaluate(
    async ({ self }) => {
      const boot = await new Promise<any>((res, rej) =>
        (window as any).require(['boot'], res, rej)
      );
      const cur = boot.getState();
      const nextPeers = Object.assign({}, cur.peers, {
        'bob@test': {
          display_name: 'Bob',
          cash: 999,
          profiles: 0,
          xp: 0,
          level: 1,
          spent: 0,
          last_seen_ts: Date.now(),
          last_seen_serial: null,
        },
      });
      boot.setState(Object.assign({}, cur, { addr: self, peers: nextPeers }));
    },
    { self: SELF }
  );

  // Bob's row should appear automatically — no click, no reload.
  await expect(page.locator('[data-testid="dd-leaderboard-row-bob@test"]').first()).toBeAttached({
    timeout: 5_000,
  });

  // Bob's cash is 999 → ranked first; check his rendered value contains 999.
  const bobRow = page.locator('[data-testid="dd-leaderboard-row-bob@test"]').first();
  await expect(bobRow.locator('.TopscoreValue')).toContainText('999');
});
