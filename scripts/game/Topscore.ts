// Topscore — single leaderboard tab (one per ranking type: cash / xp / …).
// Extracted from scripts/Game.js's IIFE in PR 6 of issue #147.
//
// Each Topscore subscribes to `app.remote.getRanking(scoretype)` and
// renders a TopscorePerp via the Render API.  Lives as a child of a
// Topscores ViewTab parent.

import appModule from '../app.js';
import { GameNode } from './GameNode.js';
import { mergeData } from './mergeData.js';

// app.remote handlers are wired up by app.start(); Topscore is only
// constructed after start() has run (Topscores.initTopscore is called from
// GameRoot.loadGame), so the wrapper functions are available when
// fetchScore fires.  Importing app eagerly at module load would race with
// the app.js → Game.js → Topscore.ts circular import on first eval —
// resolve lazily.

interface RankingRow {
  addr: string;
  display_name: string;
  value: number;
  self: boolean;
}

interface RankingResult {
  top?: RankingRow[];
  user_rank?: number;
  user_in_top?: boolean;
  error?: number;
  [key: string]: unknown;
}

// Legacy LocalEngine.getRanking call returns a jQuery Deferred (via
// app.remote wrapping), not a native Promise — Game.js's call sites use
// `.done()` / `.fail()`.  Captured loosely; later PRs may tighten when
// app.remote's return type is widened.
interface DoneFailChain {
  done(cb: (data: { result?: RankingResult }) => void): DoneFailChain;
  fail(cb: (data: { error?: string | number; message?: string }) => void): DoneFailChain;
}

interface TopscoreRenderNode {
  jdomelem?: {
    addClass?: (c: string) => void;
    removeClass?: (c: string) => void;
  };
  renderRank?: () => void;
  renderList?: () => void;
}

// Cache fetching for 30 seconds; force-bypass via the second arg.
const FETCH_CACHE_MS = 30_000;

export class Topscore extends GameNode {
  override renderType = 'TopscorePerp';
  scoretype?: string;
  lastFetch?: Date | null;

  fetchScore(type?: string, force?: boolean): void {
    const t = type || this.scoretype;
    if (!t) return;
    const now = new Date();
    if (
      !force &&
      this.lastFetch instanceof Date &&
      now.getTime() - this.lastFetch.getTime() < FETCH_CACHE_MS
    ) {
      const rn = this.renderNode as TopscoreRenderNode | undefined;
      rn?.jdomelem?.removeClass?.('loading');
      return;
    }
    const gnode = this;
    const getRanking = appModule.getApplication().remote.getRanking;
    if (!getRanking) return;
    const rankingCall = getRanking(t) as unknown as DoneFailChain;
    rankingCall
      .done(function (data) {
        if (data.result && data.result.error === undefined) {
          const merged = mergeData(
            gnode.data as Record<string, unknown> | undefined,
            data.result as unknown as Record<string, unknown>
          );
          const top = (merged.top as RankingRow[] | undefined) || [];
          (merged as Record<string, unknown>).user_in_top = top.some((row) => row.self === true);
          gnode.data = merged as Record<string, unknown>;
          const rn = gnode.renderNode as TopscoreRenderNode | undefined;
          rn?.renderRank?.();
          rn?.renderList?.();
          rn?.jdomelem?.removeClass?.('loading');
          gnode.lastFetch = new Date();
        } else {
          console.error('getRanking failed', data);
        }
      })
      .fail(function (data) {
        console.error('getRanking failed', data);
      });
  }

  override extendEventHandlers(): void {
    const gnode = this;
    this.on('vclick', function (e: unknown) {
      if (e && typeof (e as { stopPropagation?: () => void }).stopPropagation === 'function') {
        (e as { stopPropagation: () => void }).stopPropagation();
      }
      const rn = gnode.renderNode as TopscoreRenderNode | undefined;
      rn?.jdomelem?.addClass?.('loading');
      gnode.fetchScore();
    });
  }
}
