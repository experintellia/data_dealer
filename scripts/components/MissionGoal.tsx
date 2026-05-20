// Shared mission goal/reward primitives — the view-model types and the
// `MissionGoalRow` renderer used by BOTH the briefing/complete dialog
// (`popups/MissionPopup.tsx`) and the Missions-tab board card
// (`MissionCard.tsx`).  Neutral module (not under `popups/`) so the
// card doesn't reach into a popup.  The per-goal view-model is computed
// once in `scripts/game/missionView.ts`, so the two render paths can't
// drift (guarded by `tests/render/mission-card-dialog-parity.test.ts`).

import type { JSX } from 'preact';
import { renderSpriteHtml } from '../render/renderSpriteHelper.js';

export interface MissionGoalVM {
  /** Target sprite config — rendered via `renderSpriteHtml`, same
   *  pattern as `NewItemsNotification`, keeping the view-model builder
   *  out of render-land. */
  spriteConfig: unknown;
  /** Computed goal text — may contain `<span>` highlights. */
  textHtml: string;
  /** Pre-formatted "current / goal" progress HTML. */
  progressHtml: string;
  complete: boolean;
}

export interface MissionRewardVM {
  /** `MissionReward PopupSummaryItem <classMap[target]>`. */
  cssClass: string;
  amount: string;
}

/** One mission-goal row.  The dialog renders the full variant; the
 *  card renders `small` (legacy `mission_goal_small.html`: the
 *  `.MissionGoal.small` modifier, no `.MissionGoalText`). */
export function MissionGoalRow({
  goal,
  small = false,
}: {
  goal: MissionGoalVM;
  small?: boolean;
}): JSX.Element {
  const sp = renderSpriteHtml(goal.spriteConfig as Parameters<typeof renderSpriteHtml>[0]);
  const base = small ? 'MissionGoal small' : 'MissionGoal';
  // Small (Missions-tab card) variant keeps the legacy
  // `mission_goal_small.html` shape — no text, progress as a direct
  // child of the row.
  if (small) {
    return (
      <div class={goal.complete ? `${base} complete` : base}>
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: locally produced sprite markup */}
        <div class="MissionGoalSprite" dangerouslySetInnerHTML={{ __html: sp }} />
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: locally formatted progress markup */}
        <div class="MissionGoalProgress" dangerouslySetInnerHTML={{ __html: goal.progressHtml }} />
        <div class="MissionGoalStatus" />
      </div>
    );
  }
  // Full (mission dialog) variant: wrap text + progress in
  // `.MissionGoalContent` so they stack vertically as a single flex
  // item between the sprite (left) and the status stamp (right).
  // Skip the progress div for single-unit goals — `missionView.ts`
  // emits an empty `progressHtml` and the completion stamp conveys
  // the state.
  return (
    <div class={goal.complete ? `${base} complete` : base}>
      {/* biome-ignore lint/security/noDangerouslySetInnerHtml: locally produced sprite markup */}
      <div class="MissionGoalSprite" dangerouslySetInnerHTML={{ __html: sp }} />
      <div class="MissionGoalContent">
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: trusted ruleset / i18n string */}
        <div class="MissionGoalText" dangerouslySetInnerHTML={{ __html: goal.textHtml }} />
        {goal.progressHtml && (
          // biome-ignore lint/security/noDangerouslySetInnerHtml: locally formatted progress markup
          <div class="MissionGoalProgress" dangerouslySetInnerHTML={{ __html: goal.progressHtml }} />
        )}
      </div>
      <div class="MissionGoalStatus" />
    </div>
  );
}
