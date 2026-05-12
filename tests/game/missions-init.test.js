// @ts-nocheck — strict-TS quarantine; remove when this file is migrated to TS (issue #147)
//
// Missions.initMissions completion guard — when the server reports an
// empty/undefined active_missions list, no mission should be marked
// complete (and therefore no `mission_complete` event should fire).
// Pre-fix the `else` branch on line 145-150 of scripts/game/Missions.ts
// unconditionally flipped every loaded mission to complete=true on the
// `active_missions.length === 0` path, generating spurious notifications
// on every reload from a state where the player had not actually
// completed every mission.

import { describe, expect, it, vi } from 'vitest';
import { installFakeJq } from './_jq.js';

// vi.mock calls are hoisted by vitest. GameNode.ts → Render.js drags the
// whole render factory chain (app.ts ↔ Render.js ↔ Game.js) through every
// game-class import. Under v8 coverage instrumentation the eval order can
// shift enough that `class GamePerp extends GameNode` evaluates while
// GameNode's module is still being defined, throwing
// "Class extends value undefined is not a constructor or null". Stubbing
// Render.js here keeps the import graph small and deterministic.
vi.mock('../../scripts/Render.js', () => ({
  getRender: () => ({}),
  default: { getRender: () => ({}) },
}));
vi.mock('../../scripts/app.js', () => ({
  default: { remote: {}, debug: {} },
}));

installFakeJq();

const { Missions } = await import('../../scripts/game/Missions.ts');
const { Mission } = await import('../../scripts/game/Mission.ts');

function mkMissionInstance(gestalt) {
  const m = Object.create(Mission.prototype);
  m.gestalt = gestalt;
  m.id = gestalt;
  m.data = {};
  m.states = { active: false, complete: false };
  m._stateChanges = [];
  // Stub setState so we don't need to wire the full GameNode event bus.
  m.setState = function (state, value) {
    if (this.states[state] === value) return;
    this.states[state] = value;
    this._stateChanges.push([state, value]);
  };
  return m;
}

function mkMissionsInstance(missionMap) {
  const ms = Object.create(Missions.prototype);
  ms.Missions = missionMap;
  // Stub the few helpers that initMissions touches.
  ms.addChild = () => {};
  ms.updateMissionGoals = () => {};
  ms.checkProjectGoals = () => {};
  ms.getMission = function (gestalt) {
    return this.Missions[gestalt] || {};
  };
  // GameRoot stub — only addType/getTypeData are touched on the input path.
  ms.GameRoot = {
    addType: () => undefined,
    getTypeData: () => undefined,
  };
  return ms;
}

// We feed initMissions an empty `missions` array so the construction
// loop is a no-op; pre-populated `this.Missions` stubs survive, and the
// downstream completion path operates entirely on our stubs.
describe('Missions.initMissions completion guard', () => {
  it('does not mark any mission complete when active_missions is empty', () => {
    const m1 = mkMissionInstance('m1');
    const m2 = mkMissionInstance('m2');
    const ms = mkMissionsInstance({ m1, m2 });

    ms.initMissions({
      missions: [],
      active_missions: [],
    });

    expect(m1.states.complete).toBe(false);
    expect(m2.states.complete).toBe(false);
    // No spurious state events.
    expect(m1._stateChanges).toEqual([]);
    expect(m2._stateChanges).toEqual([]);
  });

  it('does not mark any mission complete when active_missions is undefined', () => {
    const m1 = mkMissionInstance('m1');
    const ms = mkMissionsInstance({ m1 });

    ms.initMissions({
      missions: [],
      // active_missions intentionally absent
    });

    expect(m1.states.complete).toBe(false);
    expect(m1._stateChanges).toEqual([]);
  });

  it('marks the active mission active and its branch ancestors complete', () => {
    const root = mkMissionInstance('mRoot');
    const child = mkMissionInstance('mChild');
    child.data = { required_mission: 'mRoot' };
    const ms = mkMissionsInstance({ mRoot: root, mChild: child });

    // Mission instances need a parentNode reference so getBranch can
    // resolve `mroot.getMission(required_mission)`.
    child.parentNode = ms;
    root.parentNode = ms;

    ms.initMissions({
      missions: [],
      active_missions: ['mChild'],
    });

    expect(child.states.active).toBe(true);
    // mChild's branch includes mRoot → mRoot is marked complete.
    expect(root.states.complete).toBe(true);
    expect(root.states.active).toBe(false);
  });
});
