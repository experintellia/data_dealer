// Regression: GameRoot.setXP / setLevel must not recurse forever when
// xp_value lands exactly on a level's xp_max (issue: collect action
// stuck loading, "RangeError: Maximum call stack size exceeded" in
// FXSimpleCue, stack alternating setXP -> setLevel -> setXP ...).
//
// Ruleset levels leave a one-XP gap between ranges (L1: 0-10,
// L2: 11-30, ...). The pre-fix client `getLevelByXP` matched the
// inclusive upper bound (`xp <= xp_max`), so xp=10 kept resolving to
// L1 while `setXP`'s `xp_value >= xp_level.xp_max` guard tried to
// level up — `setXP` -> `setLevel` -> `setXP` ping-ponged forever.
//
// We invoke the prototype methods via Function.prototype.bind against
// a stubbed `this`, sidestepping the full GameRoot/jQuery/Render
// bootstrap (same approach as origin-token-lookup.test.js).

import { describe, expect, it } from 'vitest';
import { GameRoot } from '../../scripts/game/GameRoot.ts';

const LEVELS = [
  { number: 1, xp_min: 0, xp_max: 10, ap_max: 100, ap_inc_value: 1, ap_inc_interval: 1 },
  { number: 2, xp_min: 11, xp_max: 30, ap_max: 200, ap_inc_value: 1, ap_inc_interval: 1 },
  { number: 3, xp_min: 31, xp_max: 54, ap_max: 300, ap_inc_value: 1, ap_inc_interval: 1 },
];

function mkNode(xpValue, levelObj) {
  const node = {
    data: {
      levels: LEVELS,
      game_values: { xp_level: levelObj.number },
      status_bar: { XP: {}, AP: {} },
    },
    xp_value: xpValue,
    xp_level: levelObj,
    ap_value: 0,
    renderStatusbar: { FXUpdateXP() {}, FXUpdateAP() {} },
  };
  node.getLevel = GameRoot.prototype.getLevel.bind(node);
  node.getLevelByXP = GameRoot.prototype.getLevelByXP.bind(node);
  node.setLevel = GameRoot.prototype.setLevel.bind(node);
  node.setXP = GameRoot.prototype.setXP.bind(node);
  node.setAP = GameRoot.prototype.setAP.bind(node);
  return node;
}

describe('GameRoot.getLevelByXP — xp_max is the promotion threshold', () => {
  const fn = GameRoot.prototype.getLevelByXP;
  const stub = { data: { levels: LEVELS } };

  it('resolves a mid-band xp to its own level', () => {
    expect(fn.call(stub, 5).number).toBe(1);
    expect(fn.call(stub, 20).number).toBe(2);
  });

  it('promotes to the next level when xp lands exactly on xp_max', () => {
    expect(fn.call(stub, 10).number).toBe(2);
    expect(fn.call(stub, 30).number).toBe(3);
  });

  it('resolves the next level once xp reaches its xp_min', () => {
    expect(fn.call(stub, 11).number).toBe(2);
    expect(fn.call(stub, 31).number).toBe(3);
  });

  it('returns the empty Level-shape sentinel for falsy xp', () => {
    expect(fn.call(stub, 0).number).toBe(0);
    expect(fn.call(stub, undefined).number).toBe(0);
  });
});

describe('GameRoot.setXP — no infinite recursion on a level boundary', () => {
  it('does not overflow the stack when xp_value equals xp_max', () => {
    const node = mkNode(10, LEVELS[0]);
    expect(() => node.setXP()).not.toThrow();
    expect(node.xp_level.number).toBe(2);
  });

  it('promotes via the engine entry path (setXP with a new value)', () => {
    const node = mkNode(9, LEVELS[0]);
    expect(() => node.setXP(10, true)).not.toThrow();
    expect(node.xp_value).toBe(10);
    expect(node.xp_level.number).toBe(2);
  });

  it('promotes across the top of L2 (xp_value === L2.xp_max)', () => {
    const node = mkNode(30, LEVELS[1]);
    expect(() => node.setXP()).not.toThrow();
    expect(node.xp_level.number).toBe(3);
  });

  it('stays on the current level for a mid-band xp_value', () => {
    const node = mkNode(5, LEVELS[0]);
    expect(() => node.setXP()).not.toThrow();
    expect(node.xp_level.number).toBe(1);
    expect(node.data.status_bar.XP.level).toBe(1);
  });

  it('handles a multi-level jump in a single call', () => {
    const node = mkNode(40, LEVELS[0]);
    expect(() => node.setXP()).not.toThrow();
    expect(node.xp_level.number).toBe(3);
  });
});
