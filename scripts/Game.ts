// Game — module-level glue for the GameNode/GameRoot tree.  Owns:
//   - the legacy IIFE shell that exposes the `Game.X` API for
//     legacy callers (subclasses, helpers, tickers) — all class
//     extractions in #147 mutate this object's slots via the typed
//     ESM imports below;
//   - the `APTicker` / `AniTicker` singletons (still here until
//     they earn their own modules);
//   - the `init(data)` factory that constructs `GameRoot` and
//     calls `loadGame(data)`;
//   - the `getGame()` accessor (memoised — one Game per page).
//
// File converted from Game.js to Game.ts in PR 25 of issue #147.
// `@ts-nocheck` quarantine dropped.  Strict-TS enforced.

import appModule from './app.js';
import { GameNode } from './game/GameNode.js';
import { setAniTicker } from './game/GamePerp.js';
import { GameRoot, setAPTickerForGameRoot, setAniTickerForGameRoot } from './game/GameRoot.js';
import { OrderedSet } from './game/OrderedSet.js';
// Side-effect import — seeds the perpRegistry so GamePerp's BuyPerp
// can resolve perp subclasses by-name after all modules load.
import './game/perpCtors.js';

interface APTickerSingleton {
  interval: number;
  offset: number;
  lastTick?: number;
  /** Browser-side setTimeout returns `number`; the DOM lib's
   *  `window.setTimeout` is the canonical signature here.  Typed as
   *  `number | undefined` directly to dodge the @types/node
   *  `NodeJS.Timeout` ambiguity, with `| undefined` for
   *  exactOptionalPropertyTypes. */
  timeout: number | undefined;
  listeners: OrderedSet<GameNode>;
  start(offset?: number): void;
  reset(): void;
  tick(offset?: number): void;
  getRemainingTime(): Date;
  addListener(node: GameNode): void;
  removeListener(node: GameNode): void;
  stop(): void;
}

interface AniTickerSingleton {
  interval: number;
  counter: number;
  /** Browser-side setTimeout returns `number`; the DOM lib's
   *  `window.setTimeout` is the canonical signature here.  Typed as
   *  `number | undefined` directly to dodge the @types/node
   *  `NodeJS.Timeout` ambiguity, with `| undefined` for
   *  exactOptionalPropertyTypes. */
  timeout: number | undefined;
  listeners: OrderedSet<GameNode>;
  start(): void;
  reset(): void;
  tick(): void;
  addListener(node: GameNode): void;
  removeListener(node: GameNode): void;
  stop(): void;
}

interface GameApi {
  APTicker: APTickerSingleton;
  init: (data: unknown) => GameRoot;
  GameRoot: typeof GameRoot;
  GameNode: typeof GameNode;
  // Open-ended for the long tail of legacy `Game.X` reads (see
  // `app.ts` debug-globals dump etc.).
  [key: string]: unknown;
}

const _underscore = (): { shuffle<T>(arr: T[]): T[] } =>
  globalThis._ as unknown as { shuffle<T>(arr: T[]): T[] };

const Game = (): GameApi => {
  const app = appModule.getApplication();

  /////////////////////////////////////////////
  // The APTicker (increments Action Points)
  /////////////////////////////////////////////
  // Written as a singleton, like the original Ticker.

  const APTicker: APTickerSingleton = {
    interval: 0,
    offset: 0,
    timeout: undefined,
    listeners: new OrderedSet<GameNode>(),
    start(offset?: number) {
      if (!this.timeout) this.tick(offset);
    },
    reset() {
      window.clearTimeout(this.timeout);
      this.tick();
    },
    tick(offset?: number) {
      let interval = this.interval;
      if (offset) {
        interval = interval - offset;
        this.offset = offset;
      } else {
        this.offset = 0;
      }
      if (interval > 0) {
        APTicker.lastTick = Date.now();
        this.timeout = window.setTimeout(() => {
          APTicker.listeners.each((node) => {
            (node as GameNode & { APTick?(): void }).APTick?.();
          });
          APTicker.tick();
        }, interval);
      }
    },
    getRemainingTime() {
      return new Date((this.lastTick ?? 0) + this.interval - this.offset - Date.now());
    },
    addListener(node: GameNode) {
      this.listeners.add(node);
    },
    removeListener(node: GameNode) {
      this.listeners.remove(node);
    },
    stop() {
      window.clearTimeout(this.timeout);
      this.timeout = undefined;
    },
  };

  /////////////////////////////////////////////
  // The AniTicker (drives idle-state animation)
  /////////////////////////////////////////////
  // Written as a singleton, like the original Ticker.

  const AniTicker: AniTickerSingleton = {
    interval: 5000,
    counter: 0,
    timeout: undefined,
    listeners: new OrderedSet<GameNode>(),
    start() {
      AniTicker.counter = 0;
      if (!this.timeout) this.tick();
    },
    reset() {
      window.clearTimeout(this.timeout);
      this.tick();
    },
    tick() {
      if (this.interval > 0) {
        this.timeout = window.setTimeout(() => {
          const node = AniTicker.listeners.set[0];
          AniTicker.interval = Math.random() * 1500 + 5000;
          if (node) (node as GameNode & { AniTick?(): void }).AniTick?.();
          // only shuffle when all items were served (uses counter)
          AniTicker.listeners.set = _underscore().shuffle(AniTicker.listeners.set);
          AniTicker.tick();
        }, this.interval);
      }
    },
    addListener(node: GameNode) {
      if ((node as GameNode & { AniTick?(): void }).AniTick) {
        this.listeners.add(node);
      }
    },
    removeListener(node: GameNode) {
      this.listeners.remove(node);
    },
    stop() {
      window.clearTimeout(this.timeout);
      this.timeout = undefined;
    },
  };

  // -------------------------------------------------------------------
  // Game-bootstrap factory
  // -------------------------------------------------------------------
  //
  // Every GameNode subclass / GameRoot / helper has been extracted to
  // scripts/game/*.ts.  The `Game.X` slots on the API object below are
  // re-exposures of the same imported identities for legacy callers
  // (Render.js uses `Game.GameRoot` for type guards; app.ts calls
  // `Game.init(data)`).

  const init = (data: unknown): GameRoot => {
    // Inits GameRoot as a singleton for now — there should only be one
    // GameRoot per page; loadGame() clears the instance registry first.
    const root = new GameRoot();
    (app as unknown as { game?: GameRoot }).game = root;
    root.loadGame(data as Parameters<GameRoot['loadGame']>[0]);
    return root;
  };

  // -------------------------------------------------------------------
  // The Game API — re-exposed for legacy callers / debug consoles
  // -------------------------------------------------------------------
  // Most subclasses are now accessed via direct ESM imports; these
  // slots are kept for the few remaining cross-file dynamic reads
  // (Render.js's `Game.GameRoot`, app.ts's `Game.init`, devtools
  // dumps).  Each new extraction trims one entry; the publisher
  // disappears entirely with the final cleanup PR.

  const GameApiObject: GameApi = {
    APTicker,
    init,
    GameRoot,
    GameNode,
  };

  // Inject AniTicker into GamePerp / GameRoot so their lock/unlock
  // and initEventHandlers can register listeners on the legacy ticker
  // singleton (which still lives in this module).  Disposable seam;
  // retires when AniTicker is itself extracted.
  setAniTicker(AniTicker);
  setAniTickerForGameRoot(AniTicker);
  // APTicker (level-derived AP regen interval) is consumed by
  // GameRoot.setLevel and GameRoot.APTick; injected the same way
  // as AniTicker until APTicker itself is extracted.
  setAPTickerForGameRoot(APTicker);

  return GameApiObject;
};

let _game: GameApi | undefined;

export function getGame(): GameApi {
  _game = _game ?? Game();
  return _game;
}

export default { getGame };
