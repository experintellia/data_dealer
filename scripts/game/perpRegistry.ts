// Cross-class constructor registry for the Perp class hierarchy.
//
// Background: scripts/Game.js's IIFE used to expose every subclass on a
// shared `Game` object so that `Game[node.game_type]` lookups could
// resolve to the right class.  As subclasses migrate to scripts/game/*.ts,
// the dynamic lookup needs a way to keep working without each subclass
// having to know about every other.  This module is that hub:
//
//   - Game.js calls `setPerpClasses(Game)` after the IIFE assembles the
//     public API object — this registers every class identity (extracted
//     and still-in-IIFE alike) under their game-type name.
//   - Database / future-extracted classes call `lookupPerpClass(name)` to
//     get a constructor by name.  Returns `undefined` if the class hasn't
//     been registered yet (caller decides how to handle that).
//
// Disposable seam: when every Perp class is extracted to its own .ts file
// in PR 11+, callers can switch to direct imports and the registry is
// retired with the IIFE.

import type { GameNode } from './GameNode.js';

export type PerpCtor = new (config: unknown) => GameNode;

let _classes: Record<string, PerpCtor> = {};

/** Replaces the registry.  Called once by Game.js after the IIFE
 *  assembles the API object. */
export function setPerpClasses(classes: Record<string, PerpCtor>): void {
  _classes = classes;
}

/** Returns the constructor registered under `gameType` (e.g. 'TokenPerp',
 *  'CityPerp', …) or `undefined` if nothing is registered.  Callers must
 *  null-check before instantiating. */
export function lookupPerpClass(gameType: string): PerpCtor | undefined {
  return _classes[gameType];
}
