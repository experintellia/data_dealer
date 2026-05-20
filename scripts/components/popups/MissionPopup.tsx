// Mission briefing + mission complete popups.  Both share one DOM
// shape (`.PopupBody.MissionBody`, `.Complete` modifier for the
// complete variant) — goal/reward view-models are computed by
// `buildMissionPopupProps` in `scripts/game/missionView.ts` (the
// `mission_goal.html` template carried a "MOVE THIS TO GAME" FIXME;
// the logic now lives in TS, the component just renders).

import type { JSX } from 'preact';
import i18n from '../../i18n.js';
import { MissionGoalRow, type MissionGoalVM, type MissionRewardVM } from '../MissionGoal.js';

export type { MissionGoalVM, MissionRewardVM };

export interface MissionPopupProps {
  /** `complete` renders the `.Complete` body modifier + the
   *  mission-done text/button; `briefing` is the active-mission /
   *  preview popup. */
  variant: 'briefing' | 'complete';
  decorator: string;
  title: string;
  says: string;
  /** Body copy — briefing description or the mission-done blurb. */
  bodyHtml: string;
  buttonLabel: string;
  goals: MissionGoalVM[];
  rewards: MissionRewardVM[];
  onClose: () => void;
}

export function MissionPopup({
  variant,
  decorator,
  title,
  says,
  bodyHtml,
  buttonLabel,
  goals,
  rewards,
  onClose,
}: MissionPopupProps) {
  const close = (e: JSX.TargetedMouseEvent<HTMLDivElement>): void => {
    e.stopPropagation();
    onClose();
  };
  return (
    <div
      class={variant === 'complete' ? 'PopupBody MissionBody Complete' : 'PopupBody MissionBody'}
    >
      <div class="NotificationHeader">
        {/* biome-ignore lint/a11y/useKeyWithClickEvents: legacy DOM structure, keyboard support is a separate a11y pass */}
        <div class="PopupClose" onClick={close}>
          X
        </div>
        <div class="MissionDecorator">{decorator}</div>
      </div>
      <div class="MissionContent">
        <div class="PopupTitle">{title}</div>
        <div class="MissionWrap">
          <div class="MissionGoals">
            <div class="MissionGoalsTitle">{i18n.gettext('Mission Goals')}</div>
            {goals.map((g, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: goals are a fixed positional list, no reordering
              <MissionGoalRow goal={g} key={i} />
            ))}
          </div>
          <div class="MissionRewards">
            <div class="MissionRewardsTitle">{i18n.gettext('Rewards')}</div>
            {rewards.map((r, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: rewards are a fixed positional list
              <div class={`MissionReward PopupSummaryItem ${r.cssClass}`} key={i}>
                <div class="RenderSprite Tobi" />
                {r.amount}
              </div>
            ))}
          </div>
        </div>
        <div class="NotificationBubble">
          <div class="NotificationAvatar" />
          <div class="NotificationSays">{says}</div>
          {/* biome-ignore lint/security/noDangerouslySetInnerHtml: trusted ruleset / i18n string */}
          <div class="NotificationText" dangerouslySetInnerHTML={{ __html: bodyHtml }} />
          <div class="PopupButtons NotificationButtons">
            {/* biome-ignore lint/a11y/useKeyWithClickEvents: legacy DOM structure, keyboard support is a separate a11y pass */}
            <div class="Button" data-button-id="MainButton" onClick={close}>
              {buttonLabel}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
