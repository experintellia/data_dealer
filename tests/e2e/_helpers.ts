import { type Page, expect } from '@playwright/test';

/**
 * Install `window.__ddSettle` — an in-page async poll that resolves once the
 * canonical setUpdateListener (scripts/boot.ts) has applied enough deltas for
 * the predicate to hold.
 *
 * Canonical webxdc: a handler call only SENDS; real Delta Chat (and the
 * IndexedDB simulator) deliver the update — including the sender's own — back
 * to the listener asynchronously, and the listener is the sole state mutator.
 * So any dependent follow-up (another handler that reads state, a reload that
 * replays history, or a direct state assertion) must wait for the listener to
 * apply the prior delta instead of assuming it landed synchronously.
 *
 * Must be called before `page.goto` / the first navigation so the init script
 * is present on the page and survives reloads.
 */
export async function installSettle(page: Page): Promise<void> {
  await page.addInitScript(() => {
    (window as { __ddSettle?: unknown }).__ddSettle = async (
      pred: (s: Record<string, unknown>) => boolean,
      timeoutMs = 5000,
      stepMs = 15
    ): Promise<Record<string, unknown>> => {
      const w = window as unknown as {
        require: (deps: string[], res: (m: unknown) => void, rej: (e: unknown) => void) => void;
      };
      const boot = (await new Promise<unknown>((res, rej) => w.require(['boot'], res, rej))) as {
        getState: () => Record<string, unknown>;
      };
      const t0 = Date.now();
      for (;;) {
        let s: Record<string, unknown> | null = null;
        try {
          s = boot.getState();
        } catch {
          s = null;
        }
        if (s && pred(s)) return s;
        if (Date.now() - t0 > timeoutMs) {
          throw new Error('__ddSettle: timed out waiting for listener-applied state');
        }
        await new Promise((r) => setTimeout(r, stepMs));
      }
    };
  });
}

/**
 * Boot the game and drain the first-run notification queue so a spec
 * starts from a quiescent, popup-free state.  Shared by every spec that
 * needs to drive dialogs without a stray boot briefing/tutorial landing
 * mid-test.  See the inline notes for why a single empty poll isn't
 * proof of quiescence (RenderPopup.close re-mounts the next queued cue
 * through a 250–500ms timer).
 */
export async function bootGame(page: Page): Promise<void> {
  await page.goto('/?devtools=1');
  await expect(page.locator('[data-testid="game-container"]')).toBeVisible({
    timeout: 50_000,
  });

  // Dismiss the first-launch locale picker if it appears.  Picking EN persists
  // the locale and reloads the page, so we re-wait for the game container.
  const picker = page.locator('.LangSelectOverlay');
  if (await picker.isVisible().catch(() => false)) {
    await picker.locator('.lang-pick[data-locale="en"]').click();
    await expect(page.locator('[data-testid="game-container"]')).toBeVisible({
      timeout: 50_000,
    });
  }

  // Wait for the GameRoot to be reachable.  app.ts assigns it to
  // `window.__dd._app` after `Application.start()` finishes.
  await page.waitForFunction(() => {
    return !!(window as any).__dd?._app?.game;
  });

  // First-run boot auto-queues a tutorial briefing for the first mission.
  // Pre-mark all known mission briefings as seen so subsequent loadGame
  // replays don't re-queue them, then keep firing popup_close on whatever
  // is open until the queue + the renderPopup slot drain.  Tearing down
  // the popup DOM directly doesn't work — `openNotification` mounts each
  // popup through a setTimeout(delay) that captures the popup reference,
  // so even after deleting the object the next tick re-mounts it.  Going
  // through the actual close path lets RenderPopup's lifecycle release the
  // queue cleanly.
  await page.evaluate(() => {
    const groot = (window as any).__dd?._app?.game;
    if (!groot?.raw_data) return;
    groot.raw_data.mission_briefings_seen = groot.raw_data.mission_briefings_seen || {};
    const missions = groot.Missions?.Missions ?? {};
    for (const g of Object.keys(missions)) {
      groot.raw_data.mission_briefings_seen[g] = true;
    }
  });

  // RenderPopup.close() schedules DOM removal + the next queued open through a
  // 250–500ms setTimeout that captured the popup ref, so a single momentarily
  // empty poll is not proof the system is quiescent: a re-mount timer can still
  // be in flight and fire *after* bootGame returns, landing a stray popup in
  // the middle of the test (under 2-worker CPU contention this is when the
  // dialog-lifecycle flakes — a different test each run depending on when the
  // timer lands). Keep actively draining, but only return once "empty" has
  // held across consecutive polls spanning longer than that timer window, so
  // any pending re-mount has had time to fire and be drained first.
  const STABLE_POLLS_REQUIRED = 3; // 3 × 300ms ≈ 900ms > the 500ms timer ceiling
  const MAX_ATTEMPTS = 40; // ~12s ceiling for slow/contended CI
  let consecutiveSettled = 0;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const settled = await page.evaluate(() => {
      const groot = (window as any).__dd?._app?.game;
      if (!groot) return false;
      // Drop any queued cues so the queue can't refill after the current
      // popup closes.
      if (Array.isArray(groot.NotificationQueue)) {
        groot.NotificationQueue.length = 0;
      }
      const open = groot.notificationPopup;
      if (open) {
        try {
          open.trigger('popup_close');
        } catch {
          /* fall back to direct teardown below */
        }
      }
      // Belt-and-braces teardown of any stray popup that doesn't go through
      // the GameRoot's notificationPopup slot (e.g. status info popups).
      document.querySelectorAll<HTMLElement>('.Popup').forEach((el) => {
        try {
          el.remove();
        } catch {
          /* ignore */
        }
      });
      document
        .querySelectorAll<HTMLElement>('.PopupContainer.lockOn')
        .forEach((el) => el.classList.remove('lockOn'));
      return (
        (!Array.isArray(groot.NotificationQueue) || groot.NotificationQueue.length === 0) &&
        !groot.notificationPopup &&
        document.querySelectorAll('.PopupContainer.lockOn').length === 0
      );
    });
    consecutiveSettled = settled ? consecutiveSettled + 1 : 0;
    if (consecutiveSettled >= STABLE_POLLS_REQUIRED) return;
    // Wait above the 250–500ms close/re-mount timer floor before re-checking
    // so an in-flight openNotification chain either finishes or dispatches the
    // next item we then drain on the following iteration.
    await page.waitForTimeout(300);
  }
  throw new Error('bootGame: notification queue did not stay drained after 40 attempts');
}

/**
 * Drive the full buy → reload → charge → collect → cue flow for contact035
 * and return the resulting `psid`.  Reused by Section H tests that need a
 * ProfileSet in the Database queue before driving popup interactions.
 *
 * The reload is required because buyPerp only SENDS; boot.ts replays the
 * delta on reload so contact035 exists in the game tree before chargePerp.
 * chargePerp likewise only SENDS, so `__ddSettle` waits for the listener to
 * apply it before advanceNow + collectPerp.
 */
export async function cueProfileSet(page: Page): Promise<string> {
  await page.evaluate(async () => {
    const eng = await new Promise<any>((res, rej) =>
      (window as any).require(['LocalEngine'], res, rej)
    );
    await eng.buyPerp('Imperium', 'contact035');
    await ((window as any).__ddSettle as (p: (s: any) => boolean) => Promise<unknown>)(
      (s) => !!(s.nodes ?? []).some((n: any) => n.full_path === 'Imperium.contact035')
    );
  });
  await page.reload();
  await bootGame(page);

  const psid = await page.evaluate(async () => {
    const eng = await new Promise<any>((res, rej) =>
      (window as any).require(['LocalEngine'], res, rej)
    );
    await eng.chargePerp('Imperium.contact035');
    await ((window as any).__ddSettle as (p: (s: any) => boolean) => Promise<unknown>)(
      (s) => !!(s.nodes_charging ?? []).some((c: any) => c.path === 'Imperium.contact035')
    );
    // contact035.charge_time is 30s in the ruleset — advance the injectable
    // clock past it so collectPerp doesn't return error 0.
    (window as any).__dd.advanceNow(31_000);
    const cr = await (eng as any).collectPerp('Imperium.contact035');
    const inner = cr?.result?.result;
    if (!inner?.collect_id) {
      throw new Error(`collectPerp did not return collect_id; got=${JSON.stringify(cr)}`);
    }
    const groot = (window as any).__dd?._app?.game;
    const db = groot.getDatabase();
    const ps = db.cue(inner.profile_set, inner.origin, inner.collect_id);
    return ps.psid as string;
  });
  return psid;
}
