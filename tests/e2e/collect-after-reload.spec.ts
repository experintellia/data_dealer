/**
 * Issue #114 regression — after a buy → charge → skip → collect cycle,
 * reloading the page must NOT resurrect the perp into a "collectable" state.
 *
 * The bug
 * -------
 * scripts/state.js `collectPerp` reducer removes the entry from
 * nodes_collect but does not touch nodes_charging. During live operation
 * the materializer strips the orphan in-memory before the delta is
 * committed, so post-handler state looks clean.  But on cold-start
 * replay-from-zero (page reload), the chargePerp reducer adds the entry
 * to nodes_charging, the collectPerp reducer leaves it intact, and a
 * subsequent materialize(state, now) with now >= charge_end re-promotes
 * the orphan into nodes_collect — so the UI marks the perp as
 * collectable again after reload.
 *
 * The contract this test enforces
 * -------------------------------
 *   1. Buy contact035 (free, mirrors gameplay.spec.ts / persistence.spec.ts).
 *   2. Charge it.
 *   3. window.__dd.advanceNow past charge_end.
 *   4. Collect it.
 *   5. Reload the page.
 *   6. Assert NO dd-collect-ready / nodes_collect entry exists for that path.
 *
 * SKIPPED: the architectural fix is tracked in #120. Until #120 lands,
 * the reducer leaves the orphan and step 6 fails.  Once #120 ships,
 * remove the test.skip wrapper.
 *
 * Note: this test is written to the contract from issue #114.  The
 * specific dd-collect-ready / dd-collect-button data-testid markers may
 * not yet be wired up for contact035 in the sprite UI; in that case the
 * assertion can be tightened to inspect engine state via
 * boot.getState().nodes_collect / nodes_charging directly (see the
 * commented fallback below).  Either way, the test stays skipped until
 * #120 is implemented.
 */

import { expect, test } from '@playwright/test';

const GESTALT = 'contact035';
const PATH = `Imperium.${GESTALT}`;
// charge_time from the ruleset + a small safety margin (mirrors gameplay.spec.ts).
const CHARGE_MS = 30_000 + 500;

async function waitForGameReady(page: import('@playwright/test').Page) {
  await expect(page.locator('[data-testid="game-container"]')).toBeVisible({
    timeout: 50_000,
  });
}

test.skip('collect-after-reload: collected perp does not reappear as collectable after reload (#114)', async ({
  page,
}) => {
  await page.goto('/?devtools=1');
  await waitForGameReady(page);

  // ── 1. Buy contact035 (price=0) ──────────────────────────────────────────
  await page.evaluate(async (gestalt) => {
    const eng = await new Promise<any>((res, rej) =>
      (window as any).require(['LocalEngine'], res, rej)
    );
    await eng.buyPerp('Imperium', gestalt);
  }, GESTALT);

  // ── 2. Charge it ─────────────────────────────────────────────────────────
  await page.evaluate(async (path) => {
    const eng = await new Promise<any>((res, rej) =>
      (window as any).require(['LocalEngine'], res, rej)
    );
    await eng.chargePerp(path);
  }, PATH);

  // ── 3. Skip the charge timer via injectable clock ────────────────────────
  await page.evaluate((ms) => {
    (window as any).__dd.advanceNow(ms);
  }, CHARGE_MS);

  // ── 4. Collect ───────────────────────────────────────────────────────────
  await page.evaluate(async (path) => {
    const eng = await new Promise<any>((res, rej) =>
      (window as any).require(['LocalEngine'], res, rej)
    );
    await eng.collectPerp(path);
  }, PATH);

  // ── 5. Reload — webxdc dev-mode mock persists deltas in localStorage,
  //       so boot.js will replay the entire delta log from zero. ────────────
  await page.reload();
  await waitForGameReady(page);

  // ── 6. The contract: the perp must NOT be collectable again. ─────────────
  // Preferred: a UI testid surfaces the collectable state.  If contact035 is
  // not wired up to a dd-collect-ready / dd-collect-button marker we fall
  // back to inspecting engine state directly — both forms encode the same
  // contract from #114.
  const orphan = await page.evaluate(async (path) => {
    const boot = await new Promise<any>((res, rej) => (window as any).require(['boot'], res, rej));
    const s = boot.getState();
    const inCollect = (s.nodes_collect || []).some((c: any) => c.path === path);
    const inCharging = (s.nodes_charging || []).some((c: any) => c.path === path);
    return { inCollect, inCharging };
  }, PATH);

  expect(orphan.inCollect).toBe(false);
  expect(orphan.inCharging).toBe(false);

  // Belt-and-braces: if a DOM testid is wired up for this perp it must not
  // claim the perp is collectable.  The locator may not exist, which is
  // fine — `count()` returns 0 in that case and the assertion passes.
  const collectReady = page.locator(`[data-testid="dd-collect-ready"][data-path="${PATH}"]`);
  expect(await collectReady.count()).toBe(0);
});
