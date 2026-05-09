// Tests for GameRoot.hasOriginTokenForOrigin (issue #203 regression coverage).
//
// The method only reads from `this.DBOriginTokens`. We invoke it via
// Function.prototype.call against a stubbed `this`, which sidesteps the
// full GameRoot/jQuery/Render bootstrap chain.

import { describe, expect, it } from 'vitest';
import { GameRoot } from '../../scripts/game/GameRoot.ts';

const fixture = () => ({
  DBOriginTokens: {
    origin002: { gestalt: 'origin002', originGameNode: { gestalt: 'city002' } },
    origin003: { gestalt: 'origin003', originGameNode: { gestalt: 'city003' } },
    origin999: { gestalt: 'origin999' }, // missing originGameNode
  },
});

describe('GameRoot.hasOriginTokenForOrigin (issue #203)', () => {
  const fn = GameRoot.prototype.hasOriginTokenForOrigin;

  it('is true when some origin token points to the given origin', () => {
    expect(fn.call(fixture(), 'city002')).toBe(true);
    expect(fn.call(fixture(), 'city003')).toBe(true);
  });

  it('is false when no origin token points to the given origin', () => {
    expect(fn.call(fixture(), 'city999')).toBe(false);
  });

  it('is false when DBOriginTokens is empty', () => {
    expect(fn.call({ DBOriginTokens: {} }, 'city002')).toBe(false);
  });

  it('honors the parameter (regression: legacy bug hardcoded "city002")', () => {
    const stub = {
      DBOriginTokens: {
        originA: { gestalt: 'originA', originGameNode: { gestalt: 'cityA' } },
      },
    };
    expect(fn.call(stub, 'cityA')).toBe(true);
    expect(fn.call(stub, 'city002')).toBe(false);
  });
});
