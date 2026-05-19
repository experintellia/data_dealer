// Mission card shown in the Missions ViewTab — the per-mission *board*
// element, NOT a dialog: it mounts directly on `RenderMissionPerp`'s
// board node (scripts/render/RenderTopLevelUI.ts), not through
// `dialogManager`/`dialogRegistry`.  Ports `views/mission.html` +
// `mission_goal_small.html`.  The per-goal sprite/progress view-model
// is shared with the briefing/complete dialog via
// `buildMissionCardProps` (scripts/game/missionView.ts) and the
// `MissionGoalRow` component, so a ruleset/i18n change lands in one
// place instead of drifting between card and dialog.

import type { JSX } from 'preact';
import { MissionGoalRow, type MissionGoalVM } from './MissionGoal.js';

export interface MissionCardProps {
  /** Raw mission title HTML — legacy `mission.html` used
   *  `print(data.title)` (unescaped), so the card mirrors that. */
  titleHtml: string;
  /** Every goal (legacy rendered all goals through
   *  `mission_goal_small.html` — no briefing 3-goal clip). */
  goals: MissionGoalVM[];
}

export function MissionCard({ titleHtml, goals }: MissionCardProps): JSX.Element {
  return (
    <div class="MissionInline">
      {/* biome-ignore lint/security/noDangerouslySetInnerHtml: trusted ruleset / i18n string */}
      <div class="MissionLabel" dangerouslySetInnerHTML={{ __html: titleHtml }} />
      {goals.map((g, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: goals are a fixed positional list
        <MissionGoalRow goal={g} small key={i} />
      ))}
    </div>
  );
}
