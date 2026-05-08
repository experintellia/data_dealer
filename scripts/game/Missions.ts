// Missions — leaderboard view-tab parent for the missions list.  Holds
// one Mission child per active/completed mission gestalt.  Extracted from
// scripts/Game.js's IIFE in PR 7 of issue #147.

import { type RenderApi } from '../Render.js';
import appModule from '../app.js';
import i18n from '../i18n.js';
import { GameNode, type GameNodeConfig, getByFirstId, getFirstId } from './GameNode.js';
import { Mission } from './Mission.js';
import { OrderedSet } from './OrderedSet.js';

interface RawMissionsData {
  missions: Array<{ gestalt?: string; type_data?: { gestalt?: string; [key: string]: unknown } }>;
  active_missions: string[];
  mission_goals?: Array<Record<string, unknown>>;
}

interface GameRootWithMissions {
  renderMenu: Pick<InstanceType<RenderApi['MainMenu']>, 'addButton'>;
  renderNode?: { FXMissionGoalComplete?: () => void };
  addType(gestalt: string, data: unknown): unknown;
  getTypeData(gestalt?: string): Record<string, unknown> | undefined;
  fetchProjectPowerupData(gestalt: string, cb: () => void): void;
  getDatabase(): { cue(profile_set: unknown, origin: string, collect_id: string): void };
  updateGameValues(
    game_values: Record<string, unknown>,
    levelup: boolean,
    missions: unknown,
    quiet: boolean
  ): void;
}

interface RecheckMissionsResult {
  repaired?: boolean;
  game_values?: Record<string, unknown>;
  levelup?: boolean;
  missions?: {
    complete_missions?: string[];
    mission_data?: { mission_goals?: Array<Record<string, unknown>> };
  };
}

interface DoneFailChain<T> {
  done(cb: (data: { result?: T }) => void): DoneFailChain<T>;
  fail(cb: (data: { error?: string | number; message?: string }) => void): DoneFailChain<T>;
}

export class Missions extends GameNode {
  override renderType = 'ViewTab';
  // Each child added in initMissions() is a Mission.
  declare children: OrderedSet<Mission>;
  /** Per-gestalt registry of mission instances; lookup target for getMission(). */
  Missions: Record<string, Mission> = {};
  ViewMap?: Missions;
  queue?: OrderedSet<unknown>;

  constructor(config?: GameNodeConfig) {
    super(config);
    this.ViewMap = this;
    this.queue = new OrderedSet();
  }

  override extendRender(): void {
    const groot = this.GameRoot as unknown as GameRootWithMissions;
    groot.renderMenu.addButton(i18n.gettext('Missions'), this.id, this.states);
  }

  override extendEventHandlers(): void {
    const mroot = this;
    const groot = this.GameRoot as unknown as GameRootWithMissions;

    mroot.on('states_active', function (_e: unknown, params: unknown) {
      const remote = appModule.getApplication().remote;
      if (!params || !remote || !remote.recheckMissions) {
        return;
      }
      const call = remote.recheckMissions() as unknown as DoneFailChain<RecheckMissionsResult>;
      call.done(function (data) {
        const r = data.result;
        if (!r || !r.repaired) return;
        if (r.missions && r.missions.complete_missions && r.missions.complete_missions.length) {
          groot.updateGameValues(r.game_values || {}, r.levelup === true, r.missions, true);
        } else {
          // Goal flipped without finishing the mission — refresh rows only,
          // skipping the reward/levelup popup machinery.
          mroot.updateMissionGoals(r.missions?.mission_data?.mission_goals);
        }
      });
    });
  }

  getMission(gestalt: string): Mission | Record<string, never> {
    return this.Missions[gestalt] || ({} as Record<string, never>);
  }

  initMissions(raw_data: RawMissionsData): void {
    const groot = this.GameRoot as unknown as GameRootWithMissions;
    if (!this.Missions) {
      this.Missions = {};
    }

    const active_missions = raw_data.active_missions || [];

    raw_data.missions.reverse();

    raw_data.missions.forEach((m) => {
      const td = m.type_data;
      if (td && td.gestalt) groot.addType(td.gestalt, m);
    });
    raw_data.missions.forEach((mission) => {
      const td = mission.type_data;
      const g = (td && td.gestalt) || mission.gestalt;
      if (typeof g !== 'string') return;
      const cfg: GameNodeConfig = {
        id: g,
        gestalt: g,
        states: { complete: false, active: false },
        renderNodeParent: getFirstId('Missions'),
        ViewMap: getByFirstId('Missions'),
        gameType: 'Mission',
      };
      const mtd = groot.getTypeData(g);
      if (mtd) cfg.data = mtd;
      const inst = new Mission(cfg);
      this.Missions[g] = inst;
      this.addChild(inst);
    });
    if (raw_data.mission_goals) {
      this.updateMissionGoals(raw_data.mission_goals);
    }
    if (active_missions.length) {
      active_missions.forEach((gestalt) => {
        const active_mission = this.getMission(gestalt);
        if (active_mission instanceof Mission) {
          active_mission.setState('active', true);
          active_mission.getBranch().forEach((m) => {
            m.setState('complete', true);
            m.setState('active', false);
          });
        }
      });
    } else {
      // FIXME: all missions done, process all missions
      Object.values(this.Missions).forEach((mission) => {
        mission.setState('complete', true);
        mission.setState('active', false);
      });
    }
    this.checkProjectGoals();
  }

  getActiveMissions(): Mission[] {
    return Object.values(this.Missions).filter(
      (m) => m.states.active === true && m.states.complete === false
    );
  }

  getVisibleMissions(): Mission[] {
    return Object.values(this.Missions).filter(
      (m) => m.states.active === true || m.states.complete === true
    );
  }

  getCompletedMissions(): Mission[] {
    return Object.values(this.Missions).filter(
      (m) => m.states.active === false && m.states.complete === true
    );
  }

  getNextMissions(): Mission[] {
    const next_missions: Record<string, Mission> = {};
    this.getActiveMissions().forEach((mission) => {
      const next = mission.getNext();
      if (next && next.gestalt) {
        next_missions[next.gestalt] = next;
      }
    });
    return Object.values(next_missions);
  }

  checkProjectGoals(): void {
    const groot = this.GameRoot as unknown as GameRootWithMissions;
    const fetch_project_data: Record<string, Mission> = {};
    let update_missions: Mission[] = [];

    const checkMission = (mission: Mission) => {
      const goals = (mission.data && mission.data.goals) || [];
      goals.forEach((goal) => {
        if (goal.project) {
          fetch_project_data[goal.project as string] = mission;
          update_missions.push(mission);
        }
      });
    };

    this.getVisibleMissions().forEach(checkMission);
    this.getNextMissions().forEach(checkMission);

    Object.entries(fetch_project_data).forEach(([gestalt, mission]) => {
      groot.fetchProjectPowerupData(gestalt, function () {
        // FIXME: gotta update all missions with the project in the goals,
        // make this more light weight... best with deferred done callback?
        update_missions.forEach((m) => {
          m.updateRender();
        });
        update_missions = update_missions.filter((m) => m !== mission);
      });
    });
  }

  updateMissions(missions: {
    complete_missions?: string[];
    mission_data?: {
      active_missions?: string[];
      mission_goals?: Array<Record<string, unknown>>;
    };
    rewards?: {
      profile_sets?: Array<{ profile_set: unknown; origin: string; collect_id: string }>;
    };
  }): void {
    const groot = this.GameRoot as unknown as GameRootWithMissions;

    if (missions.complete_missions) {
      missions.complete_missions.forEach((gestalt) => {
        const m = this.getMission(gestalt);
        if (m instanceof Mission) {
          m.setState('active', false);
          m.setState('complete', true);
        }
      });
    }
    this.updateMissionGoals();
    if (missions.mission_data && missions.mission_data.mission_goals) {
      missions.mission_data.mission_goals.forEach((goal) => {
        if ((goal as { complete?: boolean }).complete) {
          groot.renderNode?.FXMissionGoalComplete?.();
        }
      });
      this.updateMissionGoals(missions.mission_data.mission_goals);
    }
    if (missions.mission_data && missions.mission_data.active_missions) {
      missions.mission_data.active_missions.forEach((gestalt) => {
        const m = this.getMission(gestalt);
        if (m instanceof Mission) m.setState('active', true);
      });
    }

    if (missions.rewards && missions.rewards.profile_sets) {
      missions.rewards.profile_sets.forEach((ps) => {
        groot.getDatabase().cue(ps.profile_set, ps.origin, ps.collect_id);
      });
    }

    this.checkProjectGoals();
  }

  updateMissionGoals(goals?: Array<Record<string, unknown>>): void {
    if (goals) {
      goals.forEach((goal) => {
        const missionKey = (goal as { mission?: unknown }).mission;
        if (typeof missionKey !== 'string') return;
        const mission = this.Missions[missionKey];
        if (mission) {
          mission.updateGoal(goal as Parameters<Mission['updateGoal']>[0]);
        }
      });
    } else {
      Object.values(this.Missions).forEach((mission) => {
        const own = (mission.data && mission.data.goals) || [];
        own.forEach((goal) => {
          mission.updateGoal(goal);
        });
      });
    }
  }
}
