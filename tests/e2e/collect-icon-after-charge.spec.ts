/**
 * Regression test for the "stuck clock" / missing collect icon bug.
 *
 * Symptom (from user report)
 * --------------------------
 * After a perp finishes charging, the timer reaches zero and the clock
 * sprite continues to pulsate — the collect icon (DecoratorReady,
 * data-testid="dd-collect-ready") never appears, so the player cannot
 * collect.
 *
 * Root cause
 * ----------
 * LocalEngine fires `node_ready` via the emitter wired up in scripts/app.js:
 *
 *   LocalEngine.setEmitter(function(ev, pl) {
 *     $(document).trigger(ev, [pl]);
 *   });
 *
 * In the legacy server-coupled build, scripts/app.js carried a
 * `socket.on("node_ready", …)` handler that re-fired the event onto the
 * matching GameNode:
 *
 *   app.game.getById(data.id).trigger('node_ready', [data.result]);
 *
 * That socket bridge was deleted in #142 (Retire dead transport / RPC
 * plumbing) but no equivalent document-level listener replaced it.  The
 * per-perp `gnode.on('node_ready', …)` handlers in Game.js
 * (ContactPerp / ClientPerp / ProjectPerp / TokenPerp) listen on
 * `gnode.jq = $(this)` — a separate jQuery target from `document` — so
 * the event the engine emits never reaches `markReady()`.  The timer
 * decorator stays put, FXSnooze fires once when the local clock crosses
 * `endTime`, and no DecoratorReady is added.
 *
 * Test strategy
 * -------------
 * 1. Buy + charge contact035 through the engine (no canvas clicks).
 * 2. Reload — Game.js replays the in-progress charge from state and
 *    materialises the DecoratorTimer + chargeRunning state, putting the
 *    UI in exactly the spot the user reports stuck.
 * 3. Fire the same `$(document).trigger('node_ready', …)` call that
 *    `_scheduleChargeReady`'s setTimeout would emit at `charge_end`.
 *    This skips the 30 s wall-clock wait baked into the ruleset's
 *    `charge_time` while still exercising the document → gnode bridge
 *    that was missing.
 * 4. Assert the DecoratorReady DOM marker (`data-testid="dd-collect-ready"`)
 *    appears, and that the gnode's `chargeRunning` state has flipped to
 *    false.  Both fail before the fix, both pass after.
 */

import { test, expect } from '@playwright/test';

const GESTALT = 'contact035';
const PATH = `Imperium.${GESTALT}`;

async function waitForGameReady(page: import('@playwright/test').Page) {
  await expect(page.locator('[data-testid="game-container"]')).toBeVisible({
    timeout: 50_000,
  });
}

test('collect-icon: DecoratorReady appears after node_ready emit (no stuck clock)', async ({ page }) => {
  await page.goto('/?devtools=1');
  await waitForGameReady(page);

  // ── 1. Buy + charge contact035 through the engine. ────────────────────
  // Game.js was instantiated against a state where contact035 didn't
  // exist yet, so we reload below to let it pick up the in-progress
  // charge and render the timer.
  await page.evaluate(async (gestalt) => {
    const eng = await new Promise<any>((res, rej) =>
      (window as any).require(['LocalEngine'], res, rej),
    );
    await eng.buyPerp('Imperium', gestalt);
    await eng.chargePerp(`Imperium.${gestalt}`);
  }, GESTALT);

  // ── 2. Reload — boot.js replays the delta log, the engine's
  //       loadGame() materialises the in-progress charge, and Game.js
  //       creates a gnode for contact035 with `_loadTimer` so
  //       `extendRender` calls `markTimer` (DecoratorTimer + chargeRunning). ─
  await page.reload();
  await waitForGameReady(page);

  await expect(page.locator('.DecoratorTimer').first()).toBeVisible({ timeout: 5_000 });

  const midState = await page.evaluate((path) => {
    const appMod = (window as any).require('app');
    const game = appMod.getApplication().game;
    const last = path.split('.').pop()!;
    const gnode = game && game.getById(last);
    return {
      exists:        !!gnode,
      chargeRunning: !!(gnode && gnode.states && gnode.states.chargeRunning),
      hasReady:      !!(gnode && gnode.renderReady),
    };
  }, PATH);
  expect(midState.exists).toBe(true);
  expect(midState.chargeRunning).toBe(true);
  expect(midState.hasReady).toBe(false);

  // ── 3. Fire the node_ready document event the engine would emit at
  //       charge_end. _scheduleChargeReady's host setTimeout uses
  //       wall-clock time (msUntil = chargeEnd - clockNow at schedule
  //       time, frozen even if the override clock advances later), so we
  //       publish the event directly rather than waiting 30 s. ──────────
  await page.evaluate((gestalt) => {
    const $ = (window as any).jQuery || (window as any).$;
    $(document).trigger('node_ready', [{
      id:     gestalt,
      type:   'ContactPerp',
      path:   `Imperium.${gestalt}`,
      result: { amount: 100 },
    }]);
  }, GESTALT);

  // ── 4. The contract: the collect-ready decorator must appear and the
  //       gnode must leave chargeRunning. Before the fix, the document
  //       event has no bridge to gnode.markReady, so neither flips. ─────
  await expect(page.locator('[data-testid="dd-collect-ready"]')).toBeVisible({ timeout: 2_000 });

  const postState = await page.evaluate((path) => {
    const appMod = (window as any).require('app');
    const game = appMod.getApplication().game;
    const last = path.split('.').pop()!;
    const gnode = game && game.getById(last);
    return {
      chargeRunning: !!(gnode && gnode.states && gnode.states.chargeRunning),
      hasReady:      !!(gnode && gnode.renderReady),
    };
  }, PATH);
  expect(postState.chargeRunning).toBe(false);
  expect(postState.hasReady).toBe(true);
});
