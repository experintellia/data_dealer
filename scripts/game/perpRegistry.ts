// Cross-class constructor registry for the Perp class hierarchy.
//
// Used by `GamePerp.BuyPerp` to resolve `Game[node.game_type]` lookups
// without GamePerp.ts having to import its own subclasses (each of
// which extends GamePerp — direct imports would be a load-time cycle).
//
// Population: `scripts/game/perpCtors.ts` calls `setPerpClasses` as a
// side effect at module load.  `perpCtors.ts` is imported by
// `Game.js` (and by `Database.ts` / `DatabasePerp.ts` via their
// per-call lookups), so the registry is seeded before any BuyPerp
// flow runs.
//
// Direct callers (Database, DatabasePerp) prefer `perpCtors[name]`
// from the perpCtors module — this registry exists only for
// GamePerp's cycle-bound case.  Retires fully when GamePerp's
// dynamic-by-name construction can be turned into a free function
// (likely after GameRoot extracts).

import type { GameNode } from './GameNode.js';

// Constructor parameter is `unknown` (not `GameNodeConfig`) because
// callers (Database / GamePerp.BuyPerp) build config objects from
// server-response shapes whose individual fields are `string |
// undefined` rather than absent — `exactOptionalPropertyTypes: true`
// would reject the assignment under a tighter type without
// per-call-site narrowing.  The Perp constructors themselves accept
// `GameNodeConfig` and validate at the seam.
export type PerpCtor = new (config: unknown) => GameNode;

let _classes: Record<string, PerpCtor> = {};

export function setPerpClasses(classes: Record<string, PerpCtor>): void {
  _classes = classes;
}

/** Returns the constructor registered under `gameType` (e.g. 'TokenPerp',
 *  'CityPerp', …) or `undefined` if nothing is registered.  Callers must
 *  null-check before instantiating. */
export function lookupPerpClass(gameType: string): PerpCtor | undefined {
  return _classes[gameType];
}
