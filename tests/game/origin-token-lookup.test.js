// Tests for GameRoot.getOriginGestaltFromOriginTokenGestalt and
// GameRoot.hasOriginTokenForOrigin (issue #203 regression coverage).
//
// Both methods only read from `this.DBOriginTokens`. We invoke them via
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

describe('GameRoot.getOriginGestaltFromOriginTokenGestalt (issue #203)', () => {
  const fn = GameRoot.prototype.getOriginGestaltFromOriginTokenGestalt;

  it('returns the origin gestalt for a known origin-token key', () => {
    expect(fn.call(fixture(), 'origin002')).toBe('city002');
    expect(fn.call(fixture(), 'origin003')).toBe('city003');
  });

  it('returns undefined for an unknown origin-token key', () => {
    expect(fn.call(fixture(), 'originXXX')).toBeUndefined();
  });

  it('returns undefined when the origin-token has no originGameNode', () => {
    expect(fn.call(fixture(), 'origin999')).toBeUndefined();
  });

  it('does not hardcode "city002": every key resolves independently', () => {
    // Regression for the legacy bug where the parameter was ignored and
    // the function always probed for city002.
    const stub = {
      DBOriginTokens: {
        originA: { gestalt: 'originA', originGameNode: { gestalt: 'cityA' } },
      },
    };
    expect(fn.call(stub, 'originA')).toBe('cityA');
    expect(fn.call(stub, 'origin002')).toBeUndefined();
  });
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
});
