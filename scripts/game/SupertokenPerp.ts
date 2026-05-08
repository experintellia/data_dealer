// SupertokenPerp — supertoken perp.  Aggregates a class of tokens
// in the Database view.  Currently a thin stub: the legacy class had
// no methods beyond inheritance — render/event behavior all comes
// from GamePerp.
//
// Extracted from scripts/Game.js's IIFE in PR 16 of issue #147.

import { GamePerp } from './GamePerp.js';

export class SupertokenPerp extends GamePerp {
  override renderType = 'Perp';
  // `'inout'` matches the intended SuperToken behavior (it both
  // contains tokens AND provides them upward).  Legacy Game.js had
  // this assignment misrouted to TokenPerp via a copy-paste typo
  // (line 2509) — fixed in PR #229; see issue #191 for context.
  override cableType = 'inout' as const;
}
