// @ts-nocheck — strict-TS quarantine; remove when this file is migrated to TS (issue #147)
//
// Mission.checkTutorial step-slicing — verifies the off-by-one fix in
// scripts/game/Mission.ts. `deletefrom` records the index of the *last
// completed* tutorial step (either buyPerp already in IPerps or
// integrateProfileSet already resolved server-side). The remaining
// `steps.slice(deletefrom + 1)` must therefore start *after* that index,
// not at it (otherwise the player re-sees a step they already finished).
//
// We avoid booting the full GameNode/Render pipeline by stubbing the
// minimal jQuery/setup globals the GameNode constructor touches, then
// exercising checkTutorial via the real Mission class.

import { beforeEach, describe, expect, it, vi } from 'vitest';

// Provide $/jQuery globals before Mission.js loads (GameNode._$ reads them).
// Stamped through a single shared installer so we can keep `@ts-nocheck`
// without widening the global $ type for tsc.
import { installFakeJq } from './_jq.js';

// vi.mock is hoisted: cut the GameNode → Render.js → app.ts ↔ Game.js
// chain that v8 coverage instrumentation can reorder enough to break
// `class GamePerp extends GameNode` (see missions-init.test.js).
vi.mock('../../scripts/Render.js', () => ({
  getRender: () => ({}),
  default: { getRender: () => ({}) },
}));

installFakeJq();

const { Mission } = await import('../../scripts/game/Mission.ts');

function mkRootStub(overrides) {
  const root = Object.assign(
    {
      IPerps: {},
      raw_data: { mission_briefings_seen: {} },
      DBTokensAbsolute: {},
      _calls: { setState: [], makeNotifications: [] },
      setState(state, value) {
        this._calls.setState.push([state, value]);
      },
      makeNotifications(data) {
        this._calls.makeNotifications.push(data);
      },
      openGenericPopup() {},
      getOriginGestaltFromOriginTokenGestalt() {
        return undefined;
      },
    },
    overrides || {}
  );
  return root;
}

function mkMissionStub({ gestalt, tutorial, IPerps, originResolves } = {}) {
  // Skip the heavy GameNode constructor — we only need checkTutorial(),
  // which reads `this.states`, `this.data`, `this.gestalt`, `this.GameRoot`.
  const m = Object.create(Mission.prototype);
  m.gestalt = gestalt || 'm1';
  m.states = { active: true, complete: false };
  m.data = { tutorial: tutorial || [] };
  const root = mkRootStub({
    IPerps: IPerps || {},
    getOriginGestaltFromOriginTokenGestalt(g) {
      return originResolves && originResolves[g] ? 'origin_' + g : undefined;
    },
  });
  m.GameRoot = root;
  return { mission: m, root };
}

describe('Mission.checkTutorial step slicing', () => {
  it('drops only steps up to and including the completed buyPerp index', () => {
    const steps = [
      { buyPerp: 'perpA' }, // 0
      { buyPerp: 'perpB' }, // 1
      { buyPerp: 'perpC' }, // 2 — already bought
      { buyPerp: 'perpD' }, // 3
      { buyPerp: 'perpE' }, // 4
    ];
    const { mission, root } = mkMissionStub({
      tutorial: steps,
      IPerps: { perpC: true },
    });

    const ok = mission.checkTutorial();
    expect(ok).toBe(true);

    // Expect makeNotifications called with the remaining steps after idx 2.
    const callArg = root._calls.makeNotifications[0];
    expect(callArg).toBeTruthy();
    expect(Array.isArray(callArg.tutorial)).toBe(true);
    // After the fix, the completed step (perpC) must NOT be the first
    // entry; we should see perpD then perpE only.
    expect(callArg.tutorial.map((s) => s.buyPerp)).toEqual(['perpD', 'perpE']);
  });

  it('keeps the full step list when no step has been completed', () => {
    // Initial deletefrom must encode "no completion" so the slice yields
    // every step. Pre-fix this was deletefrom = 0 → slice(0) → all steps.
    // Post-fix deletefrom = -1 → slice(0) → all steps, same behaviour.
    const steps = [{ buyPerp: 'perpA' }, { buyPerp: 'perpB' }, { buyPerp: 'perpC' }];
    const { mission, root } = mkMissionStub({
      tutorial: steps,
      IPerps: {}, // nothing owned
    });

    const ok = mission.checkTutorial();
    expect(ok).toBe(true);
    const callArg = root._calls.makeNotifications[0];
    expect(callArg.tutorial.map((s) => s.buyPerp)).toEqual(['perpA', 'perpB', 'perpC']);
  });

  it('drops integrateProfileSet step that is already resolved', () => {
    const steps = [
      { buyPerp: 'perpA' }, // 0
      { integrateProfileSet: 'token_x' }, // 1 — already integrated
      { buyPerp: 'perpC' }, // 2
    ];
    const { mission, root } = mkMissionStub({
      tutorial: steps,
      originResolves: { token_x: true },
    });

    const ok = mission.checkTutorial();
    expect(ok).toBe(true);
    const callArg = root._calls.makeNotifications[0];
    // The resolved integrate step (index 1) must be dropped, leaving step 2.
    expect(callArg.tutorial.map((s) => s.buyPerp || s.integrateProfileSet)).toEqual(['perpC']);
  });
});
