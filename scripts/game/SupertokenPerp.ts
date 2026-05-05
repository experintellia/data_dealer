// SupertokenPerp — supertoken perp.  Aggregates a class of tokens
// in the Database view.  Currently a thin stub: the legacy class had
// no methods beyond inheritance — render/event behavior all comes
// from GamePerp.
//
// Extracted from scripts/Game.js's IIFE in PR 16 of issue #147.

import { GamePerp } from './GamePerp.js';

export class SupertokenPerp extends GamePerp {
  override renderType = 'Perp';
}
