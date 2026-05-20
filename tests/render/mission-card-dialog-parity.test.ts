// Anti-duplication guard for the mission goal/reward view-model.
//
// Before the Preact port, `views/mission_goal.html` /
// `mission_goal_small.html` (the Missions-tab card) and the
// briefing/complete dialog each computed the per-goal sprite / text /
// progress independently — a ruleset/i18n change had to be applied in
// both places or they'd drift.  Both paths now feed the single
// `buildGoal` in `scripts/game/missionView.ts` and render through the
// shared `MissionGoalRow`.  This test renders one fixture goal through
// the dialog (`MissionPopup`) and the card (`MissionCard`) and asserts
// the shared sprite/progress markup is byte-identical, so the
// duplication can't silently reappear.

import { h } from 'preact';
import { renderToString } from 'preact-render-to-string';
import { describe, expect, it } from 'vitest';
import { MissionCard } from '../../scripts/components/MissionCard.js';
import { MissionPopup } from '../../scripts/components/popups/MissionPopup.js';
import { buildMissionCardProps, buildMissionPopupProps } from '../../scripts/game/missionView.js';

// `workflow: 'reach_xp'` is intentionally NOT in any of buildGoal's
// TEXT_* sets, so the shared builder never calls the vendor `sprintf`
// global (absent under vitest).  No `popup_sprite` on the target →
// `renderSpriteHtml` returns '' early without touching the DOM shim.
const FIXTURE = {
  title: 'Reach the top',
  description: 'Climb the ladder.',
  goals_texts: { reach_xp: 'Earn experience' },
  goals: [
    {
      workflow: 'reach_xp',
      target: 'xp',
      amount: 1500,
      current_amount: 420,
      complete: false,
    },
  ],
  rewards: [{ target: 'cash_value', amount: 100 }],
};

const getType = () => undefined;
const getTypeData = () => ({ title: 'XP' });

function firstGoalBlock(html: string): string {
  const m = html.match(/<div class="MissionGoal[^"]*">.*?<div class="MissionGoalStatus">/s);
  if (!m) throw new Error(`no .MissionGoal row in:\n${html}`);
  return m[0];
}

describe('mission card / dialog goal parity', () => {
  const popupProps = buildMissionPopupProps({
    data: FIXTURE,
    states: { active: true },
    decorator: '',
    variant: 'briefing',
    getType,
    getTypeData,
  });
  const cardProps = buildMissionCardProps({ data: FIXTURE, getType, getTypeData });

  it('builds the same per-goal view-model from both entry points', () => {
    // The actual shared computation — if a future change re-forks the
    // goal logic, these diverge and this fails first.
    expect(cardProps.goals).toEqual(popupProps.goals);
  });

  it('renders byte-identical sprite + progress markup in card and dialog', () => {
    const dialogHtml = renderToString(h(MissionPopup, { ...popupProps, onClose: () => {} }));
    const cardHtml = renderToString(h(MissionCard, cardProps));

    const vm = cardProps.goals[0];
    if (!vm) throw new Error('fixture must yield one goal');
    const spriteFragment = `<div class="MissionGoalSprite"></div>`;
    const progressFragment = `<div class="MissionGoalProgress">${vm.progressHtml}</div>`;

    expect(dialogHtml).toContain(spriteFragment);
    expect(cardHtml).toContain(spriteFragment);
    expect(dialogHtml).toContain(progressFragment);
    expect(cardHtml).toContain(progressFragment);
  });

  it('renders the documented per-variant difference (small card has no text)', () => {
    const dialogGoal = firstGoalBlock(
      renderToString(h(MissionPopup, { ...popupProps, onClose: () => {} }))
    );
    const cardGoal = firstGoalBlock(renderToString(h(MissionCard, cardProps)));

    // Dialog = full variant: plain `MissionGoal`, carries the text row.
    expect(dialogGoal).toContain('<div class="MissionGoal">');
    expect(dialogGoal).toContain('<div class="MissionGoalText">');

    // Card = legacy `mission_goal_small.html`: `.MissionGoal.small`
    // modifier, no `.MissionGoalText`.
    expect(cardGoal).toContain('<div class="MissionGoal small">');
    expect(cardGoal).not.toContain('MissionGoalText');
  });
});
