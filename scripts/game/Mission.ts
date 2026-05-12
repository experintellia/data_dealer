// Mission — single mission entry shown as a MissionPerp in the Missions
// ViewTab.  Extracted from scripts/Game.js's IIFE in PR 7 of issue #147.

import appModule from '../app.js';
import { GameNode } from './GameNode.js';

interface MissionRenderNode {
  render?(): void;
}

interface GoalShape {
  position?: number;
  amount?: number;
  current_amount?: number;
  complete?: boolean;
  workflow?: string;
  target?: string;
  mission?: string;
  [key: string]: unknown;
}

interface MissionDataShape {
  goals?: GoalShape[];
  required_mission?: string;
  tutorial?: TutorialStep[];
  [key: string]: unknown;
}

interface TutorialStep {
  buyPerp?: string;
  integrateProfileSet?: string;
  nodelay?: boolean;
  [key: string]: unknown;
}

interface MissionsParent extends GameNode {
  Missions: Record<string, Mission>;
  getMission(gestalt: string): Mission | Record<string, never>;
}

export class Mission extends GameNode {
  override renderType = 'MissionPerp';
  declare data: MissionDataShape;
  // Mission instances are always constructed with a gestalt by Missions.ts
  // (the loader skips entries lacking one — see Missions.ts:96).  Narrow
  // the base class's `gestalt?: string` to required so handlers below can
  // pass it to APIs typed `string` without `!== undefined` guards.
  declare gestalt: string;
  popupTemplate = 'popup_mission.html';

  getBranch(_gestalt?: string): Mission[] {
    const mroot = this.parentNode as MissionsParent | undefined;
    const branch: Mission[] = [];
    let mission: Mission | undefined = this;
    while (mission && mission.data && mission.data.required_mission) {
      const next: Mission | Record<string, never> | undefined = mroot?.getMission(
        mission.data.required_mission
      );
      if (!next || !(next instanceof Mission)) break;
      mission = next;
      branch.push(mission);
    }
    return branch;
  }

  getNext(gestalt?: string): Mission | undefined {
    const mroot = this.parentNode as MissionsParent | undefined;
    if (!mroot || !mroot.Missions) return undefined;
    const g = gestalt || this.gestalt;
    for (const key in mroot.Missions) {
      if (Object.prototype.hasOwnProperty.call(mroot.Missions, key)) {
        const m = mroot.Missions[key];
        if (m && m.data && m.data.required_mission === g) return m;
      }
    }
    return undefined;
  }

  updateRender(): void {
    const rn = this.renderNode as MissionRenderNode | undefined;
    rn?.render?.();
  }

  updateGoal(goal: GoalShape): void {
    // TODO: take care of rendering
    const groot = this.GameRoot;
    // Legacy: `if ((goal.mission = this.gestalt)) { … }` — assigns the
    // gestalt onto goal and uses the truthy assigned value as the guard.
    goal.mission = this.gestalt;
    if (!goal.mission) return;
    const goals = this.data.goals || [];
    for (let k = 0; k < goals.length; k++) {
      const mission_goal = goals[k];
      if (mission_goal && mission_goal.position === goal.position) {
        if (goal.complete) {
          if (!goal.amount) goal.amount = 1;
          goal.current_amount = goal.amount;
        }
        if (goal.workflow === 'integrate_profiles' && goal.target) {
          const abs = groot.DBTokensAbsolute[goal.target] || 0;
          const amt = goal.amount ?? 0;
          goal.current_amount = abs <= amt ? abs : amt;
        }
        goals[k] = goal;
      }
    }
    this.updateRender();
  }

  openMissionPopup(): void {
    this.GameRoot.openGenericPopup({
      states: this.states,
      data: this.data,
      template: 'popup_mission.html',
      extendClass: 'Mission',
    });
  }

  checkTutorial(): boolean {
    const groot = this.GameRoot;
    if (this.states.active && this.data.tutorial) {
      // If the player already dismissed the mission briefing, the NPC coach
      // intro has already been seen — skip re-queuing on reload.
      const seenBriefings: Record<string, unknown> =
        (groot.raw_data && groot.raw_data.mission_briefings_seen) || {};
      if (this.gestalt && seenBriefings[this.gestalt]) {
        return false;
      }
      groot.setState('tutorial_active', true);
      // TODO: check each step for completion and delete everything before.
      let steps = this.data.tutorial.slice();
      // `deletefrom` is the index of the *last completed* tutorial step.
      // Sentinel -1 means "no step completed yet" so `slice(deletefrom + 1)`
      // still yields the full list. Pre-fix this was initialised to 0 and
      // sliced as `slice(deletefrom)`, which kept the completed step at
      // the head of the remaining tutorial (off-by-one).
      let deletefrom = -1;
      steps.forEach((step, k) => {
        if (step.buyPerp && Object.prototype.hasOwnProperty.call(groot.IPerps, step.buyPerp)) {
          deletefrom = k;
        }
        if (step.integrateProfileSet && groot.hasOriginTokenForOrigin(step.integrateProfileSet)) {
          deletefrom = k;
          step.nodelay = true;
        }
      });
      steps = steps.slice(deletefrom + 1);
      groot.makeNotifications({ tutorial: steps });
      return true;
    }
    return false;
  }

  override extendEventHandlers(): void {
    const gnode = this;
    const groot = this.GameRoot;

    gnode.on('after_render', function () {
      if (gnode.states.active) {
        if (gnode.checkTutorial()) {
          groot.makeNotifications({ mission_active: gnode.gestalt });
        }
      }
    });

    gnode.on('states_active', function (e: unknown, params: unknown) {
      if (e && typeof (e as { stopPropagation?: () => void }).stopPropagation === 'function') {
        (e as { stopPropagation: () => void }).stopPropagation();
      }
      if (!params) return;
      gnode.checkTutorial();
      groot.makeNotifications({ mission_active: gnode.gestalt });
    });

    gnode.on('local_states_complete', function () {
      const goals = gnode.data.goals || [];
      goals.forEach((goal) => {
        goal.complete = true;
        gnode.updateGoal(goal);
      });
    });

    gnode.on('states_complete', function (e: unknown, params: unknown) {
      if (e && typeof (e as { stopPropagation?: () => void }).stopPropagation === 'function') {
        (e as { stopPropagation: () => void }).stopPropagation();
      }
      if (!params) return;
      if (gnode.data.tutorial) {
        groot.setState('tutorial_active', false);
      }
      groot.makeNotifications({ mission_complete: gnode.gestalt });
    });

    gnode.on('vclick', function (e: unknown) {
      if (e && typeof (e as { stopPropagation?: () => void }).stopPropagation === 'function') {
        (e as { stopPropagation: () => void }).stopPropagation();
      }
      gnode.openMissionPopup();
    });
  }

  override extendRender(): void {
    // Legacy comment in Game.js — no-op when not active/complete.
    if (!this.states.active && !this.states.complete) {
      // gnode.renderNode.hide();
    }
  }
}

void appModule;
