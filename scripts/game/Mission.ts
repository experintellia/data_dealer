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

interface GameRootWithMissions {
  IPerps: Record<string, unknown>;
  raw_data?: { mission_briefings_seen?: Record<string, unknown>; [key: string]: unknown };
  DBTokensAbsolute: Record<string, number>;
  Missions?: { children: { set: Mission[] } };
  setState(state: string, value: boolean): void;
  makeNotifications(data: Record<string, unknown>): void;
  openGenericPopup(config: Record<string, unknown>): void;
  getOriginGestaltFromOriginTokenGestalt(g: string): string | undefined;
}

interface MissionsParent extends GameNode {
  Missions: Record<string, Mission>;
  getMission(gestalt: string): Mission | Record<string, never>;
}

export class Mission extends GameNode {
  declare data: MissionDataShape;

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
    const groot = this.GameRoot as unknown as GameRootWithMissions;
    // Legacy assignment-as-condition: `if ((goal.mission = this.gestalt))` —
    // the legacy code stamps the mission gestalt onto the goal and uses the
    // truthy assigned value as the guard.  Preserved bit-for-bit so replay
    // semantics match.
    if (this.gestalt !== undefined) goal.mission = this.gestalt;
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
    const groot = this.GameRoot as unknown as GameRootWithMissions;
    groot.openGenericPopup({
      states: this.states,
      data: this.data,
      template: 'popup_mission.html',
      extendClass: 'Mission',
    });
  }

  checkTutorial(): boolean {
    const groot = this.GameRoot as unknown as GameRootWithMissions;
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
      let deletefrom = 0;
      steps.forEach((step, k) => {
        if (step.buyPerp && Object.prototype.hasOwnProperty.call(groot.IPerps, step.buyPerp)) {
          deletefrom = k;
        }
        if (
          step.integrateProfileSet &&
          groot.getOriginGestaltFromOriginTokenGestalt(step.integrateProfileSet)
        ) {
          deletefrom = k;
          step.nodelay = true;
        }
      });
      steps = steps.slice(deletefrom);
      groot.makeNotifications({ tutorial: steps });
      return true;
    }
    return false;
  }

  override extendEventHandlers(): void {
    const gnode = this;
    const groot = this.GameRoot as unknown as GameRootWithMissions;

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

Mission.prototype.renderType = 'MissionPerp';
(Mission.prototype as unknown as { popupTemplate: string }).popupTemplate = 'popup_mission.html';

void appModule;
