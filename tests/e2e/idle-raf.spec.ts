/**
 * Idle-board rAF budget.
 *
 * RenderText labels measured under a `display:none` ancestor (TokenPerp
 * labels in the inactive Database view) used to re-queue a
 * requestAnimationFrame remeasure every frame — forced layout included —
 * until the view was shown, so an idle board burned ~120 callbacks/s.
 * The remeasure now waits for the element to become visible instead.
 */

import { expect, test } from '@playwright/test';
import { bootGame, installSettle } from './_helpers';

const TOKENS = [
  'token001',
  'token002',
  'token003',
  'token004',
  'token005',
  'token006',
  'token007',
  'token008',
  'token009',
];

test('idle board with a hidden Database does not spin requestAnimationFrame', async ({ page }) => {
  await installSettle(page);
  await page.addInitScript(() => {
    const w = window as unknown as { __rafCount: number };
    w.__rafCount = 0;
    const raf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (cb) => {
      w.__rafCount++;
      return raf(cb);
    };
    // Track which elements a still-connected ResizeObserver watches.
    const watched = new Set<Element>();
    (window as unknown as { __roWatched: Set<Element> }).__roWatched = watched;
    const RO = window.ResizeObserver;
    window.ResizeObserver = class extends RO {
      els: Element[] = [];
      override observe(el: Element, o?: ResizeObserverOptions): void {
        this.els.push(el);
        watched.add(el);
        super.observe(el, o);
      }
      override disconnect(): void {
        for (const el of this.els) watched.delete(el);
        super.disconnect();
      }
    };
  });
  await bootGame(page);

  // Integrate one profile set carrying nine tokens so the (hidden) Database
  // view holds nine labelled TokenPerps.
  await page.evaluate(async (tokens) => {
    const w = window as any;
    const boot = await new Promise<any>((res, rej) => w.require(['boot'], res, rej));
    const eng = await new Promise<any>((res, rej) => w.require(['LocalEngine'], res, rej));
    const state = boot.getState();
    state.game_values = { ...state.game_values, ap_snapshot: 10 };
    state.db_queue = [
      {
        origin: 'Imperium.test.contactA',
        collect_id: 'cq_idle_raf',
        profile_set: {
          profiles_value: 200,
          tokens_map: Object.fromEntries(tokens.map((t: string) => [t, { amount: 100 }])),
        },
      },
    ];
    state.integrated_ids = {};
    boot.setState(state);
    await eng.integrateCollected('cq_idle_raf');
    await w.__ddSettle((s: any) => !!s.integrated_ids?.cq_idle_raf);
  }, TOKENS);
  await page.reload();
  await bootGame(page);
  await expect(page.locator('#Database .DecoratorLabel')).toHaveCount(TOKENS.length);

  // Idle board, Database hidden: sample the rAF rate over one second.  The
  // bound leaves room for a stray 300 ms camera tween but not for even one
  // label polling every frame (~60/s; nine of them measured ~540/s).
  const perSecond = await page.evaluate(async () => {
    const w = window as unknown as { __rafCount: number };
    const start = w.__rafCount;
    await new Promise((r) => setTimeout(r, 1000));
    return w.__rafCount - start;
  });
  expect(perSecond, 'rAF callbacks per idle second').toBeLessThan(30);

  // A label removed before it was ever laid out must release its observer,
  // or the observer pins the detached label (and its node) in memory.
  const removed = await page.evaluate(() => {
    const w = window as any;
    const label = w.__dd._app.game.getDatabase().getToken('token001').renderNode.DecoratorLabel;
    const watchedBefore = w.__roWatched.has(label.domelem);
    label.remove();
    return { watchedBefore, watchedAfter: w.__roWatched.has(label.domelem) };
  });
  expect(removed).toEqual({ watchedBefore: true, watchedAfter: false });

  // Showing the Database must still measure the labels to their text width
  // (not the 200 px fallback a hidden measure produces).
  await page.locator('.mm-tab[data-button-id="Database"]').click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>('#Database .DecoratorLabel')].every((el) => {
          const locked = el.offsetWidth;
          const prev = el.style.width;
          el.style.width = 'auto';
          const natural = el.offsetWidth;
          el.style.width = prev;
          return locked > 0 && locked === natural;
        })
      )
    )
    .toBe(true);
});
