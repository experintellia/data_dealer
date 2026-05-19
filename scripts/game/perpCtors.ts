// Direct-import map of perp constructors keyed by `gameType`.
//
// Replaces the IIFE-end `setPerpClasses(Game)` call in scripts/Game.js
// (PR 17 of issue #147).  Importing this module both:
//   - exposes `perpCtors[name]` for typed direct lookups in Database
//     and DatabasePerp (the only callers that need a runtime
//     by-name resolution and don't have a cycle problem); and
//   - seeds `perpRegistry` as a side effect, so `GamePerp.BuyPerp`'s
//     `lookupPerpClass(name)` keeps working without GamePerp.ts
//     having to import the perp subclasses directly (which would
//     create a cycle: GamePerp ↔ AgentPerp / CityPerp / …).
//
// The `perpRegistry` indirection retires fully when GamePerp.BuyPerp
// no longer needs a dynamic by-name construction — likely once
// GameRoot extracts and the buy-flow can be a free function.

import { AgentPerp } from './AgentPerp.js';
import { CityPerp } from './CityPerp.js';
import { ClientPerp } from './ClientPerp.js';
import { ContactPerp } from './ContactPerp.js';
import { DatabasePerp } from './DatabasePerp.js';
import { ProjectPerp } from './ProjectPerp.js';
import { ProxyPerp } from './ProxyPerp.js';
import { PusherPerp } from './PusherPerp.js';
import { TokenPerp } from './TokenPerp.js';
import { type PerpCtor, setPerpClasses } from './perpRegistry.js';

// The `as PerpCtor` casts widen each subclass's declared
// constructor parameter (`GameNodeConfig`) to the registry's
// `unknown`-input shape — see perpRegistry.ts for the rationale.
export const perpCtors: Record<string, PerpCtor> = {
  AgentPerp: AgentPerp as unknown as PerpCtor,
  CityPerp: CityPerp as unknown as PerpCtor,
  ClientPerp: ClientPerp as unknown as PerpCtor,
  ContactPerp: ContactPerp as unknown as PerpCtor,
  DatabasePerp: DatabasePerp as unknown as PerpCtor,
  ProjectPerp: ProjectPerp as unknown as PerpCtor,
  ProxyPerp: ProxyPerp as unknown as PerpCtor,
  PusherPerp: PusherPerp as unknown as PerpCtor,
  TokenPerp: TokenPerp as unknown as PerpCtor,
};

setPerpClasses(perpCtors);
