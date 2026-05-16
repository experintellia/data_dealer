// Mission popup view-model builder.  Ports the per-goal text /
// sprite / progress computation from `views/mission_goal.html` +
// `mission_rewards.html` (the goal template even carried a "MOVE
// THIS TO GAME" FIXME).  Both the notification cue path
// (`GameRoot.makeNotifications`) and the direct open
// (`Mission.openMissionPopup`) feed this; the Preact `MissionPopup`
// component just renders the result.
//
// NOTE: the two partials still exist — `views/mission.html` (the
// not-yet-ported mission-perp card in the Missions tab) renders them
// too.  This logic is therefore duplicated with them during the
// transition; both go away in tier 8 when the card ports.

import type {
  MissionGoalVM,
  MissionPopupProps,
  MissionRewardVM,
} from '../components/popups/MissionPopup.js';
import { span, sprintf, toKSNum } from '../dd-helpers.js';
import i18n from '../i18n.js';

interface GoalLike {
  workflow?: string;
  project?: string;
  target?: string;
  amount?: number;
  current_amount?: number;
  complete?: boolean;
  [k: string]: unknown;
}

interface RewardLike {
  target?: string;
  amount?: unknown;
}

interface MissionViewData {
  title?: string;
  description?: string;
  says?: string;
  goals?: GoalLike[];
  goals_texts?: Record<string, string>;
  rewards?: RewardLike[];
  [k: string]: unknown;
}

interface TypeLike {
  type_data?: Record<string, unknown>;
  [k: string]: unknown;
}

export interface BuildMissionPopupArgs {
  data: MissionViewData;
  states: { active?: boolean } | undefined;
  /** `data.mission_decorator` equivalent — empty for the direct open. */
  decorator: string;
  variant: 'briefing' | 'complete';
  getType(gestalt?: string): TypeLike | undefined;
  getTypeData(gestalt?: string): Record<string, unknown> | undefined;
}

// Reward target → CSS modifier (legacy `mission_rewards.html` classMap).
const REWARD_CLASS: Record<string, string> = {
  cash_value: 'Cash',
  karma_value: 'Risk Up',
  collect_amount: 'Profiles',
  xp_value: 'XP',
};

const TEXT_TARGET_ONLY = new Set(['buy_perp']);
const TEXT_CHARGE = new Set(['charge_perp']);
const TEXT_COLLECT = new Set(['upgrade_token']);
const TEXT_AMOUNT_TARGET = new Set(['collect_cash', 'collect_profiles', 'integrate_profiles']);

function buildGoal(
  goal: GoalLike,
  data: MissionViewData,
  getType: BuildMissionPopupArgs['getType'],
  getTypeData: BuildMissionPopupArgs['getTypeData']
): MissionGoalVM {
  const workflow = goal.workflow ?? '';
  let text = data.goals_texts?.[workflow] ?? '';
  const goalAmount = goal.amount || 1;
  const currentAmount = goal.current_amount || 0;

  let tdata: Record<string, unknown> = {};
  let targetTitle: string | undefined;
  let targetSprite: unknown;
  let projectTitle = '';
  let powerupdata: Record<string, unknown> = {};

  if (goal.project) {
    const ptype = getType(goal.project) ?? {};
    const pdata = ptype.type_data ?? {};
    projectTitle = span((pdata.title as string | undefined) ?? '');
    powerupdata = { title: goal.target };
    const sub = goal.target ? (ptype[goal.target] as TypeLike | undefined) : undefined;
    if (sub) powerupdata = sub.type_data ?? powerupdata;
    targetSprite = powerupdata.popup_sprite;
    targetTitle = powerupdata.title as string | undefined;
  } else {
    tdata = getTypeData(goal.target) ?? {};
    targetTitle = tdata.title as string | undefined;
    targetSprite = tdata.popup_sprite;
  }
  const targetTitleSpan = span(targetTitle ?? '');

  if (TEXT_TARGET_ONLY.has(workflow)) {
    if (tdata.mgoal_text) text = sprintf(tdata.mgoal_text as string, targetTitleSpan);
  } else if (workflow === 'buy_powerup') {
    if (powerupdata.mgoal_text) {
      text = sprintf(powerupdata.mgoal_text as string, targetTitleSpan, projectTitle);
    } else if (text) {
      text = sprintf(text, targetTitleSpan, projectTitle);
    }
  } else if (TEXT_CHARGE.has(workflow)) {
    if (tdata.mgoal_text_charge_perp) {
      text = sprintf(tdata.mgoal_text_charge_perp as string, targetTitleSpan);
    }
  } else if (TEXT_COLLECT.has(workflow)) {
    if (tdata.mgoal_text_collect_perp) {
      text = sprintf(tdata.mgoal_text_collect_perp as string, targetTitleSpan);
    }
  } else if (TEXT_AMOUNT_TARGET.has(workflow)) {
    if (text) text = sprintf(text, span(toKSNum(goal.amount ?? 0)), targetTitleSpan);
  }

  return {
    spriteConfig: targetSprite,
    textHtml: text,
    progressHtml: `${toKSNum(currentAmount)} / ${span(toKSNum(goalAmount), 'highlight')}`,
    complete: goal.complete === true,
  };
}

export function buildMissionPopupProps(
  args: BuildMissionPopupArgs
): Omit<MissionPopupProps, 'onClose'> {
  const { data, states, decorator, variant, getType, getTypeData } = args;
  const allGoals = data.goals ?? [];
  // Briefing clips to 3 (legacy popup_mission.html — pagination
  // FIXME); complete shows every goal.
  const goalSource = variant === 'briefing' ? allGoals.slice(0, 3) : allGoals;
  const goals = goalSource.map((g) => buildGoal(g, data, getType, getTypeData));

  const rewards: MissionRewardVM[] = (data.rewards ?? []).map((r) => ({
    cssClass: REWARD_CLASS[r.target ?? ''] ?? '',
    amount: String(r.amount ?? ''),
  }));

  const buttonLabel =
    variant === 'complete'
      ? i18n.gettext('mission_done button')
      : states?.active
        ? i18n.gettext('mission button')
        : i18n.gettext('Close');

  const bodyHtml =
    variant === 'complete' ? i18n.gettext('mission_done text') : (data.description ?? '');

  return {
    variant,
    decorator,
    title: data.title ?? '',
    says: data.says || i18n.gettext('Mark sagt:'),
    bodyHtml,
    buttonLabel,
    goals,
    rewards,
  };
}
