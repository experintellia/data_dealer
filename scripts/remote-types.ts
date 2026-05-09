// Shared result-payload types for `app.remote.*` handlers used by
// multiple consumer files (perp lifecycle handlers, buy/sell flows).
//
// Per-handler types that are only consumed in one file stay co-located
// with that consumer and are referenced from `app.ts` via `import type`
// (see `AppRemote` in `scripts/app.ts`).
//
// The shapes are intentionally permissive supersets — each consumer
// narrows further locally.  This module is the seam introduced by the
// AppRemote-typing PR: it lets `AppRemote.collectPerp` etc. return
// `DoneFailChain<…>` instead of the raw `JQueryLike` that previously
// forced every call site through an `as unknown as DoneFailChain<…>`
// cast.

/** Shared shape returned by `app.remote.collectPerp` for any
 *  lifecycle-style perp (ContactPerp / ClientPerp / ProjectPerp /
 *  TokenPerp).  The `result?` payload differs per perp subtype — the
 *  superset shape below covers every consumer's expected fields. */
export interface CollectResult {
  result?: {
    profile_set?: { profiles_value: number; [k: string]: unknown };
    origin?: unknown;
    collect_id?: unknown;
    cash?: number;
    token_upgraded_amount?: number;
    [k: string]: unknown;
  };
  error?: number;
  game_values?: Record<string, unknown> & { karma_value?: number };
  levelup?: boolean;
  missions?: unknown;
  karma_incident?: string;
}

/** Shared shape returned by `app.remote.buyPowerup` / `sellPowerup` /
 *  `buySlots`.  All three handlers funnel through the same
 *  `_persistDelta` machinery in LocalEngine and produce the same payload
 *  shape. */
export interface BuyPowerupResult {
  error?: number;
  game_values?: Record<string, unknown>;
  levelup?: boolean;
  missions?: unknown;
  node?: { instance_data?: Record<string, unknown> };
}
