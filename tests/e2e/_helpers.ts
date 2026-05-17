import type { Page } from '@playwright/test';

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
